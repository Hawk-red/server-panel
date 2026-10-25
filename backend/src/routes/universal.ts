import type { FastifyInstance } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import { loadInputs } from '../services/receiver.js'
import * as uni from '../services/universalRemote.js'

// Универсальный пульт: только состав и порядок плиток двух столбцов. Сами команды уходят прежними маршрутами
// (/api/receiver/command, /api/tv/key, /api/smarthome/ha/scene) со своими белыми списками и лимитами.
export async function universalRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)
  const who = (req: { clientIp?: string }) => ({ ip: req.clientIp ?? '', user: 'admin' })
  const columnParams = { type: 'object', required: ['column'], properties: { column: { type: 'string', enum: [...uni.COLUMNS] } } } as const

  const column = (c: uni.UniColumn) => ({ buttons: uni.view(c), defaults: uni.defaults(c), isDefault: uni.isDefault(c) })
  const payload = () => ({ columns: { tv: column('tv'), receiver: column('receiver') }, catalog: uni.catalog(), max: uni.MAX_BUTTONS })

  app.get('/api/universal/remote', async () => {
    // Набор по умолчанию правого столбца — живые входы ресивера; чтение кэшируется на минуту, ошибку глушим
    await loadInputs().catch(() => [])
    return payload()
  })

  app.put<{ Params: { column: uni.UniColumn }; Body: { buttons?: unknown } }>('/api/universal/remote/:column', { schema: { params: columnParams } }, async (req, reply) => {
    const c = req.params.column
    const r = uni.setButtons(c, req.body?.buttons)
    if (!r.ok) {
      audit({ ...who(req), action: 'universal.remote', target: c, result: 'error', details: { message: r.message } })
      return reply.code(400).send({ message: r.message, code: 'bad' })
    }
    audit({ ...who(req), action: 'universal.remote', target: c, result: 'ok', details: { count: r.value.length } })
    return payload()
  })

  app.post<{ Params: { column: uni.UniColumn } }>('/api/universal/remote/:column/reset', { schema: { params: columnParams } }, async (req) => {
    uni.resetButtons(req.params.column)
    audit({ ...who(req), action: 'universal.remote', target: `${req.params.column}:reset`, result: 'ok' })
    return payload()
  })
}
