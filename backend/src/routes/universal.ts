import type { FastifyInstance } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import * as uni from '../services/universalRemote.js'

// Универсальный пульт: только состав и порядок плиток. Сами команды уходят прежними маршрутами
// (/api/receiver/command, /api/tv/key, /api/smarthome/ha/scene) со своими белыми списками и лимитами.
export async function universalRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)
  const who = (req: { clientIp?: string }) => ({ ip: req.clientIp ?? '', user: 'admin' })
  const payload = () => ({ buttons: uni.view(), defaults: uni.DEFAULTS, isDefault: uni.isDefault(), catalog: uni.catalog(), max: uni.MAX_BUTTONS })

  app.get('/api/universal/remote', async () => payload())

  app.put<{ Body: { buttons?: unknown } }>('/api/universal/remote', async (req, reply) => {
    const r = uni.setButtons(req.body?.buttons)
    if (!r.ok) {
      audit({ ...who(req), action: 'universal.remote', target: 'buttons', result: 'error', details: { message: r.message } })
      return reply.code(400).send({ message: r.message, code: 'bad' })
    }
    audit({ ...who(req), action: 'universal.remote', target: 'buttons', result: 'ok', details: { count: r.value.length } })
    return payload()
  })

  app.post('/api/universal/remote/reset', async (req) => {
    uni.resetButtons()
    audit({ ...who(req), action: 'universal.remote', target: 'reset', result: 'ok' })
    return payload()
  })
}
