import type { FastifyInstance } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import { errText } from '../mask.js'
import * as ugoos from '../services/ugoos.js'
import * as remote from '../services/ugoosRemote.js'

// Android TV бокс UGOOS SK1: статус, ключи пульта из белого списка, привязки кнопок. Только через Home Assistant,
// сопряжения нет (ADB уже настроен в интеграции HA) — в отличие от tv.ts (Samsung) здесь нет /pair.
export async function ugoosRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)
  const who = (req: { clientIp?: string }) => ({ ip: req.clientIp ?? '', user: 'admin' })
  const fail = (e: unknown, reply: import('fastify').FastifyReply) => {
    const err = e as ugoos.TvError
    const code = err.code === 'bad' ? 400 : err.code === 'rate' ? 429 : err.code === 'unpaired' || err.code === 'denied' ? 409 : 502
    return reply.code(code).send({ message: errText(err), code: err.code ?? 'offline' })
  }

  app.get('/api/ugoos/status', async () => ugoos.getStatus())

  app.post<{ Body: { key?: unknown } }>('/api/ugoos/key', async (req, reply) => {
    const key = typeof req.body?.key === 'string' ? req.body.key : ''
    if (!ugoos.isKey(key)) return fail(new ugoos.TvError('Эта кнопка недопустима', 'bad'), reply)
    const quiet = ugoos.QUIET_KEYS.has(key)
    try {
      const r = await ugoos.sendKey(key)
      if (!quiet) audit({ ...who(req), action: 'ugoos.key', target: key, result: 'ok', details: { via: r.via } })
      return { key, ok: true }
    } catch (e) {
      if (!quiet) audit({ ...who(req), action: 'ugoos.key', target: key, result: 'error', details: { message: errText(e) } })
      return fail(e, reply)
    }
  })

  app.get('/api/ugoos/remote', async () => ({ defaults: remote.REMOTE_DEFAULTS, bindings: remote.getBindings(), commands: remote.commandCatalog() }))
  app.put<{ Params: { button: string }; Body: { command?: unknown } }>('/api/ugoos/remote/:button', async (req, reply) => {
    const c = req.body?.command
    if (!(typeof c === 'string' || c === null)) return reply.code(400).send({ message: 'Нужен ключ, null или "default"', code: 'bad' })
    try {
      remote.setBinding(req.params.button, c === 'default' ? undefined : c)
    } catch (e) {
      return fail(e, reply)
    }
    audit({ ...who(req), action: 'ugoos.remote', target: req.params.button, result: 'ok', details: { command: c } })
    return { defaults: remote.REMOTE_DEFAULTS, bindings: remote.getBindings() }
  })
}
