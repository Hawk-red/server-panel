import { createHash, randomBytes } from 'node:crypto'
import { verify } from '@node-rs/argon2'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { audit } from './audit.js'
import { config } from './config.js'
import { db } from './db.js'
import { networkOf } from './net.js'

export const SESSION_COOKIE = 'sp_session'
const USER = 'admin'
const DAY = 24 * 60 * 60 * 1000

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

type SessionRow = { id_hash: string; expires_at: number; ip: string }

const q = {
  insertSession: db.prepare(
    `INSERT INTO sessions (id_hash, created_at, expires_at, last_seen, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)`
  ),
  getSession: db.prepare(`SELECT id_hash, expires_at, ip FROM sessions WHERE id_hash = ? AND expires_at > ?`),
  touchSession: db.prepare(`UPDATE sessions SET last_seen = ?, ip = ? WHERE id_hash = ?`),
  deleteSession: db.prepare(`DELETE FROM sessions WHERE id_hash = ?`),
  countFailures: db.prepare(`SELECT COUNT(*) AS n, MIN(ts) AS first FROM login_failures WHERE ip = ? AND ts > ?`),
  addFailure: db.prepare(`INSERT INTO login_failures (ip, ts) VALUES (?, ?)`),
  clearFailures: db.prepare(`DELETE FROM login_failures WHERE ip = ?`),
  cleanup: db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`),
  cleanupFailures: db.prepare(`DELETE FROM login_failures WHERE ts <= ?`),
  cleanupAudit: db.prepare(`DELETE FROM audit_log WHERE ts <= ?`),
}

declare module 'fastify' {
  interface FastifyRequest {
    clientIp: string
    session?: { idHash: string; expiresAt: number }
  }
}

export function getSession(req: FastifyRequest) {
  const token = req.cookies[SESSION_COOKIE]
  if (!token) return undefined
  const row = q.getSession.get(sha256(token), Date.now()) as SessionRow | undefined
  if (!row) return undefined
  q.touchSession.run(Date.now(), req.clientIp, row.id_hash)
  return { idHash: row.id_hash, expiresAt: row.expires_at }
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
  q.cleanupAudit.run(Date.now() - 365 * DAY) // журнал действий хранится год
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { password?: unknown } }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['password'],
          properties: { password: { type: 'string', maxLength: 512 } },
        },
      },
    },
    async (req, reply) => {
      const ip = req.clientIp
      const windowStart = Date.now() - config.loginWindowMin * 60 * 1000
      const { n, first } = q.countFailures.get(ip, windowStart) as { n: number; first: number | null }
      if (n >= config.loginMaxFailures) {
        const waitMin = Math.max(1, Math.ceil(((first ?? Date.now()) + config.loginWindowMin * 60 * 1000 - Date.now()) / 60000))
        audit({ ip, action: 'auth.login', result: 'denied', details: { reason: 'rate-limit' } })
        return reply
          .code(429)
          .header('Retry-After', String(waitMin * 60))
          .send({ message: `Слишком много попыток. Повторите через ${waitMin} мин.` })
      }
      if (!config.passwordHash) {
        return reply.code(503).send({ message: 'Пароль панели не задан (npm run set-password)' })
      }

      const ok = await verify(config.passwordHash, String(req.body.password)).catch(() => false)
      if (!ok) {
        q.addFailure.run(ip, Date.now())
        audit({ ip, action: 'auth.login', result: 'denied', details: { reason: 'bad-password' } })
        return reply.code(401).send({ message: 'Неверный пароль' })
      }

      q.clearFailures.run(ip)
      const token = randomBytes(32).toString('base64url')
      const now = Date.now()
      const expiresAt = now + config.sessionDays * DAY
      q.insertSession.run(sha256(token), now, expiresAt, now, ip, String(req.headers['user-agent'] ?? '').slice(0, 300))
      audit({ ip, user: USER, action: 'auth.login', result: 'ok' })
      return reply
        .setCookie(SESSION_COOKIE, token, {
          path: '/',
          httpOnly: true,
          sameSite: 'strict',
          // Панель работает по HTTP внутри LAN/VPN, поэтому без Secure
          secure: false,
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
    return reply.clearCookie(SESSION_COOKIE, { path: '/' }).send({ ok: true })
  })

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => ({
    user: USER,
    ip: req.clientIp,
    network: networkOf(req.clientIp),
    expiresAt: new Date(req.session!.expiresAt).toISOString(),
  }))
}
