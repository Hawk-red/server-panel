import { createHash, randomBytes } from 'node:crypto'
import { verify } from '@node-rs/argon2'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { audit } from './audit.js'
import { config } from './config.js'
import { db } from './db.js'
import { notifySecurity } from './notifier.js'
import { isInternal, networkOf } from './net.js'
import { consumeSecondFactor, peekSecondFactor, totpEnabled } from './security.js'

export const SESSION_COOKIE = 'sp_session'
const USER = 'admin'
const DAY = 24 * 60 * 60 * 1000

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

type SessionRow = { id_hash: string; expires_at: number; ip: string; source: 'internal' | 'external' }

const q = {
  insertSession: db.prepare(
    `INSERT INTO sessions (id_hash, created_at, expires_at, last_seen, ip, user_agent, source, second_factor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  getSession: db.prepare(`SELECT id_hash, expires_at, ip, source FROM sessions WHERE id_hash = ? AND expires_at > ?`),
  listSessions: db.prepare(`SELECT id_hash, created_at, expires_at, last_seen, ip, user_agent, source, second_factor FROM sessions WHERE expires_at > ? ORDER BY last_seen DESC`),
  deleteAllSessions: db.prepare(`DELETE FROM sessions`),
  deleteOtherSessions: db.prepare(`DELETE FROM sessions WHERE id_hash != ?`),
  touchSession: db.prepare(`UPDATE sessions SET last_seen = ?, ip = ? WHERE id_hash = ?`),
  deleteSession: db.prepare(`DELETE FROM sessions WHERE id_hash = ?`),
  countFailures: db.prepare(`SELECT COUNT(*) AS n, MIN(ts) AS first FROM login_failures WHERE ip = ? AND ts > ?`),
  addFailure: db.prepare(`INSERT INTO login_failures (ip, ts, ext) VALUES (?, ?, ?)`),
  countExtFailures: db.prepare(`SELECT COUNT(*) AS n FROM login_failures WHERE ext = 1 AND ts > ?`),
  getBlock: db.prepare(`SELECT until, level, updated_at FROM ip_blocks WHERE ip = ?`),
  setBlock: db.prepare(`INSERT INTO ip_blocks (ip, until, level, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(ip) DO UPDATE SET until = excluded.until, level = excluded.level, updated_at = excluded.updated_at`),
  cleanupBlocks: db.prepare(`DELETE FROM ip_blocks WHERE updated_at <= ?`),
  listBlocks: db.prepare(`SELECT ip, until, level, updated_at FROM ip_blocks WHERE until > ? ORDER BY until DESC`),
  deleteBlock: db.prepare(`DELETE FROM ip_blocks WHERE ip = ?`),
  failuresByIp: db.prepare(`SELECT ip, COUNT(*) AS n FROM login_failures WHERE ts > ? GROUP BY ip`),
  clearFailures: db.prepare(`DELETE FROM login_failures WHERE ip = ?`),
  cleanup: db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`),
  cleanupFailures: db.prepare(`DELETE FROM login_failures WHERE ts <= ?`),
  cleanupAudit: db.prepare(`DELETE FROM audit_log WHERE ts <= ?`),
}

declare module 'fastify' {
  interface FastifyRequest {
    clientIp: string
    session?: { idHash: string; expiresAt: number; source: 'internal' | 'external' }
  }
}

export function getSession(req: FastifyRequest) {
  const token = req.cookies[SESSION_COOKIE]
  if (!token) return undefined
  const row = q.getSession.get(sha256(token), Date.now()) as SessionRow | undefined
  if (!row) return undefined
  // Сессия, созданная изнутри (без второго фактора), снаружи недействительна: украденный cookie не обходит 2FA
  if (row.source === 'internal' && !isInternal(req)) return undefined
  q.touchSession.run(Date.now(), req.clientIp, row.id_hash)
  return { idHash: row.id_hash, expiresAt: row.expires_at, source: row.source }
}

// preHandler для закрытых эндпоинтов
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const session = getSession(req)
  if (!session) return reply.code(401).send({ message: 'Требуется вход' })
  req.session = session
}

export function cleanupAuth() {
  q.cleanup.run(Date.now())
  q.cleanupFailures.run(Date.now() - config.loginWindowMin * 60 * 1000)
  q.cleanupBlocks.run(Date.now() - 7 * DAY)
  q.cleanupAudit.run(Date.now() - 365 * DAY) // журнал действий хранится год
}


// ---- Защита от подбора (только внешние адреса; внутренних блокировки не касаются) ----
const BLOCK_MINUTES = [15, 60, 360, 1440] // 15 мин → 1 ч → 6 ч → 24 ч (потолок)
const EXTERNAL_GLOBAL_FAILURES = 30 // неудач за окно со всех внешних адресов вместе → внешние входы закрываются до конца окна
const NOTIFY_BLOCK_EVERY = 10 * 60 * 1000
const lastBlockNotice = new Map<string, number>()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const failDelay = () => sleep(300 + Math.random() * 500) // небольшая задержка после неудачи

const fmtMsk = (ts: number) => new Date(ts).toLocaleString('ru-RU')

function activeBlock(ip: string): { until: number } | null {
  const b = q.getBlock.get(ip) as { until: number } | undefined
  return b && b.until > Date.now() ? b : null
}

// Блокировка внешнего IP; повторные блокировки (в пределах 7 суток) растут
function blockIp(ip: string) {
  const prev = q.getBlock.get(ip) as { level: number; updated_at: number } | undefined
  const level = prev && prev.updated_at > Date.now() - 7 * DAY ? Math.min(prev.level + 1, BLOCK_MINUTES.length - 1) : 0
  const until = Date.now() + BLOCK_MINUTES[level] * 60_000
  q.setBlock.run(ip, until, level, Date.now())
  q.clearFailures.run(ip)
  audit({ ip, action: 'auth.block', result: 'denied', details: { where: 'external', minutes: BLOCK_MINUTES[level], level } })
  if (Date.now() - (lastBlockNotice.get(ip) ?? 0) > NOTIFY_BLOCK_EVERY) {
    lastBlockNotice.set(ip, Date.now())
    void notifySecurity(`🚫 Панель: заблокирован IP ${ip} на ${BLOCK_MINUTES[level]} мин (подбор пароля или кода). ${fmtMsk(Date.now())}`)
  }
}

const GENERIC_FAIL = 'Неверный пароль или код'

// Блокировки от подбора (раздел «Безопасность»): активные блоки панели и число неудач по адресам за окно
export function listPanelBlocks() {
  const rows = q.listBlocks.all(Date.now()) as { ip: string; until: number; level: number; updated_at: number }[]
  const fails = new Map((q.failuresByIp.all(Date.now() - config.loginWindowMin * 60 * 1000) as { ip: string; n: number }[]).map((r) => [r.ip, r.n]))
  return rows.map((r) => ({ ip: r.ip, until: r.until, level: r.level, failures: fails.get(r.ip) ?? 0 }))
}

// Снять блок панели и обнулить счётчик неудач адреса; true — блок или неудачи были
export function clearIpBlock(ip: string): boolean {
  const blocked = q.deleteBlock.run(ip).changes > 0
  const failed = q.clearFailures.run(ip).changes > 0
  return blocked || failed
}

export type SessionInfo = { id: string; source: 'internal' | 'external'; ip: string; userAgent: string | null; createdAt: number; lastSeen: number; expiresAt: number; secondFactor: boolean; current: boolean }

export function listSessions(currentHash?: string): SessionInfo[] {
  const rows = q.listSessions.all(Date.now()) as { id_hash: string; created_at: number; expires_at: number; last_seen: number; ip: string; user_agent: string | null; source: 'internal' | 'external'; second_factor: number }[]
  return rows.map((r) => ({ id: r.id_hash.slice(0, 16), source: r.source, ip: r.ip, userAgent: r.user_agent, createdAt: r.created_at, lastSeen: r.last_seen, expiresAt: r.expires_at, secondFactor: r.second_factor === 1, current: r.id_hash === currentHash }))
}
// Завершить сессии: все или все, кроме текущей
export function endSessions(exceptHash?: string) {
  return exceptHash ? q.deleteOtherSessions.run(exceptHash).changes : q.deleteAllSessions.run().changes
}
export function endSessionById(id: string, exceptHash?: string) {
  const rows = q.listSessions.all(Date.now()) as { id_hash: string }[]
  const hit = rows.find((r) => r.id_hash.startsWith(id) && r.id_hash !== exceptHash)
  if (hit) q.deleteSession.run(hit.id_hash)
  return Boolean(hit)
}

export async function authRoutes(app: FastifyInstance) {
  // Публично: откуда пришёл запрос (страница входа показывает поле кода только снаружи)
  app.get('/api/auth/info', async (req) => ({ external: !isInternal(req) }))

  app.post<{ Body: { password?: unknown; code?: unknown } }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['password'],
          properties: { password: { type: 'string', maxLength: 512 }, code: { type: 'string', maxLength: 32 } },
        },
      },
    },
    async (req, reply) => {
      const ip = req.clientIp
      const external = !isInternal(req)
      const where = external ? 'external' : 'internal'
      const windowStart = Date.now() - config.loginWindowMin * 60 * 1000
      const { n, first } = q.countFailures.get(ip, windowStart) as { n: number; first: number | null }
      if (n >= config.loginMaxFailures) {
        const waitMin = Math.max(1, Math.ceil(((first ?? Date.now()) + config.loginWindowMin * 60 * 1000 - Date.now()) / 60000))
        audit({ ip, action: 'auth.login', result: 'denied', details: { reason: 'rate-limit', where } })
        return reply
          .code(429)
          .header('Retry-After', String(waitMin * 60))
          .send({ message: `Слишком много попыток. Повторите через ${waitMin} мин.` })
      }
      if (!config.passwordHash) {
        return reply.code(503).send({ message: 'Пароль панели не задан (npm run set-password)' })
      }
      if (external) {
        const blk = activeBlock(ip)
        if (blk) {
          const waitMin = Math.max(1, Math.ceil((blk.until - Date.now()) / 60000))
          audit({ ip, action: 'auth.login', result: 'denied', details: { reason: 'blocked', where } })
          return reply.code(429).header('Retry-After', String(waitMin * 60)).send({ message: `Слишком много попыток. Повторите через ${waitMin} мин.` })
        }
        const { n: total } = q.countExtFailures.get(windowStart) as { n: number }
        if (total >= EXTERNAL_GLOBAL_FAILURES) {
          audit({ ip, action: 'auth.login', result: 'denied', details: { reason: 'external-global-limit', where } })
          return reply.code(429).header('Retry-After', '900').send({ message: 'Слишком много неудачных попыток входа снаружи. Повторите позже.' })
        }
      }
      // Снаружи — никогда только по паролю: без включённой 2FA внешний вход закрыт
      if (external && !totpEnabled()) {
        audit({ ip, action: 'auth.login', result: 'denied', details: { reason: 'no-2fa', where } })
        return reply.code(403).send({ message: 'Сначала включите двухфакторный вход из домашней сети' })
      }

      // Пароль и код проверяются оба и всегда (без раннего выхода); ошибка снаружи — одна и та же для обоих
      const passOk = await verify(config.passwordHash, String(req.body.password)).catch(() => false)
      const factor = external ? peekSecondFactor(String(req.body.code ?? '')) : null
      if (!passOk || (external && !factor)) {
        q.addFailure.run(ip, Date.now(), external ? 1 : 0)
        audit({ ip, action: 'auth.login', result: 'denied', details: { reason: external ? 'bad-credentials' : 'bad-password', where } })
        if (external && (q.countFailures.get(ip, windowStart) as { n: number }).n >= config.loginMaxFailures) blockIp(ip)
        await failDelay()
        return reply.code(401).send({ message: external ? GENERIC_FAIL : 'Неверный пароль' })
      }
      // Код гасится только после верного пароля; параллельный повтор того же кода не пройдёт
      if (external && !consumeSecondFactor(factor!)) {
        q.addFailure.run(ip, Date.now(), 1)
        audit({ ip, action: 'auth.login', result: 'denied', details: { reason: 'code-reused', where } })
        await failDelay()
        return reply.code(401).send({ message: GENERIC_FAIL })
      }

      q.clearFailures.run(ip)
      const token = randomBytes(32).toString('base64url')
      const now = Date.now()
      // Внешняя сессия короче (12 часов) и не продлевается: срок фиксирован при входе
      const expiresAt = now + (external ? config.externalSessionHours * 60 * 60 * 1000 : config.sessionDays * DAY)
      q.insertSession.run(sha256(token), now, expiresAt, now, ip, String(req.headers['user-agent'] ?? '').slice(0, 300), where, external ? 1 : 0)
      audit({ ip, user: USER, action: 'auth.login', result: 'ok', details: { where, factor: factor?.kind ?? null } })
      if (external) void notifySecurity(`🔐 Вход в панель из интернета: IP ${ip}, ${fmtMsk(now)}`)
      return reply
        .setCookie(SESSION_COOKIE, token, {
          path: '/',
          httpOnly: true,
          sameSite: 'strict',
          // Secure — когда запрос пришёл по HTTPS (через nginx, X-Forwarded-Proto); старый вход по http:// в LAN продолжает работать
          secure: req.protocol === 'https',
          expires: new Date(expiresAt),
        })
        .send({ ok: true })
    }
  )

  app.post('/api/auth/logout', async (req, reply) => {
    const session = getSession(req)
    if (session) {
      q.deleteSession.run(session.idHash)
      audit({ ip: req.clientIp, user: USER, action: 'auth.logout', result: 'ok' })
    }
    return reply.clearCookie(SESSION_COOKIE, { path: '/', secure: req.protocol === 'https' }).send({ ok: true })
  })

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => ({
    user: USER,
    ip: req.clientIp,
    network: networkOf(req.clientIp),
    external: !isInternal(req),
    expiresAt: new Date(req.session!.expiresAt).toISOString(),
  }))
}

// Повторная проверка пароля перед опасным действием (например, перезагрузка). Использует тот же лимит
// неудачных попыток, что и вход: перебор пароля здесь так же ограничен.
export async function confirmPanelPassword(ip: string, password: string): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const windowStart = Date.now() - config.loginWindowMin * 60 * 1000
  const { n, first } = q.countFailures.get(ip, windowStart) as { n: number; first: number | null }
  if (n >= config.loginMaxFailures) {
    const waitMin = Math.max(1, Math.ceil(((first ?? Date.now()) + config.loginWindowMin * 60 * 1000 - Date.now()) / 60000))
    return { ok: false, status: 429, message: `Слишком много попыток. Повторите через ${waitMin} мин.` }
  }
  if (!config.passwordHash) return { ok: false, status: 503, message: 'Пароль панели не задан' }
  const ok = await verify(config.passwordHash, password).catch(() => false)
  if (!ok) {
    q.addFailure.run(ip, Date.now(), 0)
    await failDelay()
    return { ok: false, status: 401, message: 'Неверный пароль' }
  }
  q.clearFailures.run(ip)
  return { ok: true }
}
