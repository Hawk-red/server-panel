import type { FastifyInstance } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import { config } from '../config.js'
import { errText } from '../mask.js'
import * as tv from '../services/tv.js'
import * as remote from '../services/tvRemote.js'

// Телевизор Samsung: статус, ключи пульта из белого списка, сопряжение, привязки кнопок. Токен наружу не отдаётся (только paired: boolean).
export async function tvRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)
  const who = (req: { clientIp?: string }) => ({ ip: req.clientIp ?? '', user: 'admin' })
  const fail = (e: unknown, reply: import('fastify').FastifyReply) => {
    const err = e as tv.TvError
    const code = err.code === 'bad' ? 400 : err.code === 'rate' ? 429 : err.code === 'unpaired' || err.code === 'denied' ? 409 : 502
    return reply.code(code).send({ message: errText(err), code: err.code ?? 'offline' })
  }

  app.get('/api/tv/status', async () => ({ ...(await tv.getStatus()), sceneOn: config.tv.sceneOn }))

  app.post<{ Body: { key?: unknown } }>('/api/tv/key', async (req, reply) => {
    const key = typeof req.body?.key === 'string' ? req.body.key : ''
    if (!tv.isKey(key)) return fail(new tv.TvError('Эта кнопка недопустима', 'bad'), reply)
    const quiet = tv.QUIET_KEYS.has(key)
    try {
      const r = await tv.sendKey(key)
      if (!quiet) audit({ ...who(req), action: 'tv.key', target: key, result: 'ok', details: { port: r.port } })
      return { key, ok: true }
    } catch (e) {
      if (!quiet) audit({ ...who(req), action: 'tv.key', target: key, result: 'error', details: { message: errText(e) } })
      return fail(e, reply)
    }
  })

  app.post('/api/tv/pair', async (req, reply) => {
    try {
      const r = await tv.pair()
      audit({ ...who(req), action: 'tv.pair', target: 'samsung', result: 'ok', details: { mode: r.mode } })
      return { paired: true, mode: r.mode }
    } catch (e) {
      audit({ ...who(req), action: 'tv.pair', target: 'samsung', result: 'error', details: { message: errText(e) } })
      return fail(e, reply)
    }
  })

  app.get('/api/tv/remote', async () => ({ defaults: remote.REMOTE_DEFAULTS, bindings: remote.getBindings(), commands: remote.commandCatalog() }))
  app.put<{ Params: { button: string }; Body: { command?: unknown } }>('/api/tv/remote/:button', async (req, reply) => {
    const c = req.body?.command
    if (!(typeof c === 'string' || c === null)) return reply.code(400).send({ message: 'Нужен ключ, null или "default"', code: 'bad' })
    try {
      remote.setBinding(req.params.button, c === 'default' ? undefined : c)
    } catch (e) {
      return fail(e, reply)
    }
    audit({ ...who(req), action: 'tv.remote', target: req.params.button, result: 'ok', details: { command: c } })
    return { defaults: remote.REMOTE_DEFAULTS, bindings: remote.getBindings() }
  })
}
