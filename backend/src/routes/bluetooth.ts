import type { FastifyInstance, FastifyReply } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import * as helper from '../services/bluetoothHelper.js'

const limiter = helper.createLimiter(3000)
const brief = (s: helper.BtState) => ({ active: s.active, enabled: s.enabled, autostart: s.autostart })
const body = { type: 'object', required: ['on'], additionalProperties: false, properties: { on: { type: 'boolean' } } } as const

export async function bluetoothRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  const fail = (reply: FastifyReply, e: unknown) => {
    const status = e instanceof helper.HelperError ? e.status : 500
    return reply.code(status).send({ message: (e as Error).message.split('\n')[0] || 'действие не выполнено', ...(status === 503 ? { code: 'helper-missing' } : {}) })
  }

  app.get('/api/bluetooth/state', async (_req, reply) => {
    try {
      return await helper.getState()
    } catch (e) {
      return fail(reply, e)
    }
  })

  // Изменение: ограничение частоты, состояние «было → стало» в журнал аудита
  const change = (action: string, apply: (on: boolean) => Promise<helper.BtState>) =>
    async (req: { clientIp: string; body: { on: boolean } }, reply: FastifyReply) => {
      const act = `${action}.${req.body.on ? 'on' : 'off'}`
      const wait = limiter.take()
      if (wait > 0) return reply.code(429).header('Retry-After', String(wait)).send({ message: `слишком часто, подождите ${wait} с` })
      try {
        const before = await helper.getState().catch(() => null)
        const after = await apply(req.body.on)
        audit({ ip: req.clientIp, user: 'admin', action: act, details: { from: before && brief(before), to: brief(after) }, result: 'ok' })
        return after
      } catch (e) {
        audit({ ip: req.clientIp, user: 'admin', action: act, details: { message: (e as Error).message.split('\n')[0] }, result: 'error' })
        return fail(reply, e)
      } finally {
        limiter.release()
      }
    }

  app.post<{ Body: { on: boolean } }>('/api/bluetooth/power', { schema: { body } }, change('bluetooth.service', helper.setPower))
  app.post<{ Body: { on: boolean } }>('/api/bluetooth/autostart', { schema: { body } }, change('bluetooth.autostart', helper.setAutostart))
}
