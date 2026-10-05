// «Безопасность»: двухфакторный вход, доступ из интернета, активные сессии. Только изнутри (домашняя сеть / VPN).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { audit } from '../audit.js'
import { confirmPanelPassword, endSessionById, endSessions, listSessions, requireAuth, SESSION_COOKIE } from '../auth.js'
import { isInternal } from '../net.js'
import * as sec from '../security.js'

const who = (req: FastifyRequest) => ({ ip: req.clientIp, user: 'admin' })
const codeBody = { type: 'object', required: ['code'], properties: { code: { type: 'string', maxLength: 32 } } } as const
const pwCodeBody = { type: 'object', required: ['password', 'code'], properties: { password: { type: 'string', maxLength: 512 }, code: { type: 'string', maxLength: 32 } } } as const

async function requireInternal(req: FastifyRequest, reply: FastifyReply) {
  if (!isInternal(req)) return reply.code(403).send({ message: 'Доступно только из домашней сети или через WireGuard' })
}

export async function securityRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)
  app.addHook('preHandler', requireInternal)

  app.get('/api/security', async (req) => ({
    totp: { enabled: sec.totpEnabled(), enabledAt: sec.enabledAt(), recoveryLeft: sec.recoveryLeft() },
    external: { enabled: sec.externalEnabled() },
    sessions: listSessions(req.session!.idHash),
  }))

  // 1) выдать секрет и QR (QR строится локально); 2) подтвердить первым кодом
  app.post('/api/security/totp/setup', async (req, reply) => {
    try {
      return await sec.startSetup('admin')
    } catch (e) {
      return reply.code((e as { statusCode?: number }).statusCode ?? 400).send({ message: (e as Error).message })
    }
  })

  app.post<{ Body: { code: string } }>('/api/security/totp/enable', { schema: { body: codeBody } }, async (req, reply) => {
    const r = sec.confirmSetup(req.body.code)
    if (!r) {
      audit({ ...who(req), action: 'security.2fa-enable', result: 'denied' })
      return reply.code(400).send({ message: 'Неверный код или настройка устарела — начните заново' })
    }
    const ended = endSessions(req.session!.idHash)
    audit({ ...who(req), action: 'security.2fa-enable', details: { otherSessionsEnded: ended }, result: 'ok' })
    return r
  })

  // Отключение и пересоздание кодов — только по паролю и действующему коду
  async function confirm(req: FastifyRequest<{ Body: { password: string; code: string } }>, reply: FastifyReply, action: string) {
    const pw = await confirmPanelPassword(req.clientIp, req.body.password)
    const factor = pw.ok ? sec.peekSecondFactor(req.body.code) : null
    if (!pw.ok || !factor || !sec.consumeSecondFactor(factor)) {
      audit({ ...who(req), action, result: 'denied' })
      reply.code(pw.ok ? 401 : pw.status).send({ message: pw.ok ? 'Неверный пароль или код' : pw.message })
      return false
    }
    return true
  }

  app.post<{ Body: { password: string; code: string } }>('/api/security/totp/disable', { schema: { body: pwCodeBody } }, async (req, reply) => {
    if (!(await confirm(req, reply, 'security.2fa-disable'))) return
    sec.disableTotp()
    const ended = endSessions(req.session!.idHash)
    audit({ ...who(req), action: 'security.2fa-disable', details: { otherSessionsEnded: ended }, result: 'ok' })
    return { ok: true }
  })

  app.post<{ Body: { password: string; code: string } }>('/api/security/totp/recovery', { schema: { body: pwCodeBody } }, async (req, reply) => {
    if (!(await confirm(req, reply, 'security.2fa-recovery'))) return
    const codes = sec.regenerateRecovery()
    const ended = endSessions(req.session!.idHash)
    audit({ ...who(req), action: 'security.2fa-recovery', details: { otherSessionsEnded: ended }, result: 'ok' })
    return { recoveryCodes: codes }
  })

  app.post<{ Body: { enabled: boolean } }>('/api/security/external', { schema: { body: { type: 'object', required: ['enabled'], properties: { enabled: { type: 'boolean' } } } } }, async (req, reply) => {
    try {
      sec.setExternal(req.body.enabled)
    } catch (e) {
      return reply.code((e as { statusCode?: number }).statusCode ?? 400).send({ message: (e as Error).message })
    }
    if (!req.body.enabled) endSessions(req.session!.idHash) // выключили доступ снаружи — внешние сессии не нужны
    audit({ ...who(req), action: 'security.external', details: { enabled: req.body.enabled }, result: 'ok' })
    return { ok: true }
  })

  // «Выйти везде»: includeCurrent=false — только остальные устройства
  app.post<{ Body: { includeCurrent?: boolean } }>('/api/security/sessions/end-all', async (req, reply) => {
    const all = req.body?.includeCurrent === true
    const n = endSessions(all ? undefined : req.session!.idHash)
    audit({ ...who(req), action: 'security.sessions-end-all', details: { includeCurrent: all, ended: n }, result: 'ok' })
    if (all) reply.clearCookie(SESSION_COOKIE, { path: '/', secure: req.protocol === 'https' })
    return { ended: n }
  })

  app.post<{ Params: { id: string } }>('/api/security/sessions/:id/end', async (req, reply) => {
    if (!/^[0-9a-f]{16}$/.test(req.params.id)) return reply.code(400).send({ message: 'неверный идентификатор' })
    const ok = endSessionById(req.params.id, req.session!.idHash)
    audit({ ...who(req), action: 'security.session-end', target: req.params.id.slice(0, 8), result: ok ? 'ok' : 'error' })
    return ok ? { ok: true } : reply.code(404).send({ message: 'сессия не найдена или это текущая' })
  })
}
