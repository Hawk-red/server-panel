import type { FastifyInstance } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import * as scanner from '../network/scanner.js'

const TYPES = ['router', 'server', 'desktop', 'laptop', 'phone', 'tablet', 'tv', 'receiver', 'ir', 'iot', 'printer', 'unknown']
const MAC_RE = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/

export async function networkRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  app.get('/api/network', async () => ({
    devices: scanner.listDevices(),
    summary: scanner.summary(),
    status: scanner.status,
  }))

  app.post('/api/network/discover', async (req, reply) => {
    try {
      const n = await scanner.discover()
      audit({ ip: req.clientIp, user: 'admin', action: 'network.discover', result: 'ok', details: { online: n } })
      return { ok: true, online: n }
    } catch (e) {
      return reply.code(500).send({ message: (e as Error).message })
    }
  })

  app.patch<{ Params: { mac: string }; Body: { name?: string | null; type?: string; known?: boolean } }>(
    '/api/network/devices/:mac',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            name: { type: ['string', 'null'], maxLength: 80 },
            type: { type: 'string', enum: TYPES },
            known: { type: 'boolean' },
            location: { type: ['string', 'null'], maxLength: 80 },
            note: { type: ['string', 'null'], maxLength: 500 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const mac = req.params.mac.toLowerCase()
      if (!MAC_RE.test(mac)) return reply.code(400).send({ message: 'некорректный MAC' })
      try {
        scanner.updateDevice(mac, req.body as Parameters<typeof scanner.updateDevice>[1])
        audit({ ip: req.clientIp, user: 'admin', action: 'network.device-update', target: mac, details: req.body, result: 'ok' })
        return { ok: true }
      } catch (e) {
        const err = e as Error & { statusCode?: number }
        return reply.code(err.statusCode ?? 500).send({ message: err.message })
      }
    }
  )

  app.put<{ Body: { macs: string[] } }>(
    '/api/network/order',
    { schema: { body: { type: 'object', required: ['macs'], properties: { macs: { type: 'array', maxItems: 1000, items: { type: 'string', pattern: '^[0-9a-f]{2}(:[0-9a-f]{2}){5}$' } } } } } },
    async (req) => {
      scanner.reorderDevices(req.body.macs)
      return { ok: true }
    }
  )

  app.delete<{ Params: { mac: string } }>('/api/network/devices/:mac', async (req, reply) => {
    const mac = req.params.mac.toLowerCase()
    if (!MAC_RE.test(mac)) return reply.code(400).send({ message: 'некорректный MAC' })
    scanner.deleteDevice(mac)
    audit({ ip: req.clientIp, user: 'admin', action: 'network.device-delete', target: mac, result: 'ok' })
    return { ok: true }
  })

  // Сканирование портов запускается в фоне: ответ сразу, статус — в status.scanning
  app.post<{ Params: { mac: string } }>('/api/network/devices/:mac/scan', async (req, reply) => {
    const mac = req.params.mac.toLowerCase()
    if (!MAC_RE.test(mac)) return reply.code(400).send({ message: 'некорректный MAC' })
    if (scanner.status.scanning) return reply.code(409).send({ message: `уже идёт сканирование ${scanner.status.scanning.ip}` })
    audit({ ip: req.clientIp, user: 'admin', action: 'network.port-scan', target: mac, result: 'ok' })
    scanner.scanPorts(mac).catch((e) => req.log.warn({ mac, err: (e as Error).message }, 'сканирование портов не удалось'))
    return reply.code(202).send({ ok: true })
  })
}
