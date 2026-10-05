import type { FastifyInstance } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import * as bt from '../services/bluetooth.js'

const who = (ip: string) => ({ ip, user: 'admin' })

export async function wirelessRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  app.get('/api/wireless', async () => {
    const [adapter, paired, wifi] = await Promise.all([bt.adapter(), bt.pairedDevices(), bt.wifiStatus()])
    return { bluetooth: { adapter, paired, scanning: bt.isScanning() }, wifi }
  })

  app.post<{ Body: { on: boolean } }>(
    '/api/wireless/bluetooth/power',
    { schema: { body: { type: 'object', required: ['on'], properties: { on: { type: 'boolean' } } } } },
    async (req, reply) => {
      try {
        await bt.setPower(req.body.on)
        audit({ ...who(req.clientIp), action: `bluetooth.${req.body.on ? 'on' : 'off'}`, result: 'ok' })
        return { ok: true }
      } catch (e) {
        const message = (e as Error).message
        audit({ ...who(req.clientIp), action: `bluetooth.${req.body.on ? 'on' : 'off'}`, result: 'error', details: { message } })
        return reply.code(500).send({ message })
      }
    }
  )

  app.post('/api/wireless/bluetooth/scan', async (req, reply) => {
    try {
      const found = await bt.scan20s()
      audit({ ...who(req.clientIp), action: 'bluetooth.scan', result: 'ok', details: { found: found.length } })
      return { found }
    } catch (e) {
      const message = (e as Error).message
      audit({ ...who(req.clientIp), action: 'bluetooth.scan', result: 'error', details: { message } })
      return reply.code(message.includes('уже идёт') ? 409 : 500).send({ message })
    }
  })
}
