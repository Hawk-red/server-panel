import type { FastifyInstance, FastifyReply } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import * as store from '../services/smarthome.js'
import { assertLocal, MAX_DEVICES, urlHost, parseUrl, validateDevice, type DeviceInput } from '../services/smarthomeCore.js'

const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } } as const

// Проверка тела и адреса (только локальная сеть); при ошибке сама отвечает 400
async function accept(body: unknown, reply: FastifyReply): Promise<DeviceInput | null> {
  const c = validateDevice(body)
  if (!c.ok) {
    reply.code(400).send({ message: c.message, field: c.field })
    return null
  }
  const v = c.value
  const checks: [string, string | null][] = [
    ['host', v.host],
    ['url', v.url ? urlHost(parseUrl(v.url)!) : null],
  ]
  for (const [field, host] of checks) {
    if (!host) continue
    try {
      await assertLocal(host)
    } catch (e) {
      reply.code(400).send({ message: (e as Error).message, field })
      return null
    }
  }
  return v
}

export async function smarthomeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  app.get('/api/smarthome/devices', async () => ({ devices: store.listWithStatus(), now: Date.now() }))

  app.post('/api/smarthome/devices', async (req, reply) => {
    const v = await accept(req.body, reply)
    if (!v) return
    if (store.countDevices() >= MAX_DEVICES) return reply.code(409).send({ message: `Не больше ${MAX_DEVICES} устройств` })
    const d = store.createDevice(v)
    audit({ ip: req.clientIp, user: 'admin', action: 'smarthome.device.create', target: d.name, details: { id: d.id, kind: d.kind, room: d.room }, result: 'ok' })
    return reply.code(201).send(d)
  })

  app.put<{ Params: { id: number } }>('/api/smarthome/devices/:id', { schema: { params: idParams } }, async (req, reply) => {
    const before = store.getDevice(req.params.id)
    if (!before) return reply.code(404).send({ message: 'Устройство не найдено' })
    const v = await accept(req.body, reply)
    if (!v) return
    const d = store.updateDevice(req.params.id, v)!
    const changed = Object.keys(v).filter((k) => (before as Record<string, unknown>)[k] !== (v as Record<string, unknown>)[k])
    audit({ ip: req.clientIp, user: 'admin', action: 'smarthome.device.update', target: d.name, details: { id: d.id, changed }, result: 'ok' })
    return d
  })

  app.delete<{ Params: { id: number } }>('/api/smarthome/devices/:id', { schema: { params: idParams } }, async (req, reply) => {
    const before = store.getDevice(req.params.id)
    if (!before || !store.deleteDevice(req.params.id)) return reply.code(404).send({ message: 'Устройство не найдено' })
    audit({ ip: req.clientIp, user: 'admin', action: 'smarthome.device.delete', target: before.name, details: { id: before.id, kind: before.kind }, result: 'ok' })
    return { ok: true }
  })
}
