import type { FastifyInstance } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import * as bt from '../services/bluetooth.js'
import * as wifi from '../services/wifi.js'

const who = (ip: string) => ({ ip, user: 'admin' })
const UUID = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' }

// Общий обработчик действий: успех → журнал и ответ, ошибка → журнал и понятный текст пользователю
async function act<T>(clientIp: string, reply: { code: (n: number) => { send: (b: unknown) => unknown } }, action: string, target: string | undefined, fn: () => Promise<T>) {
  try {
    const result = await fn()
    audit({ ...who(clientIp), action, target, result: 'ok' })
    return result ?? { ok: true }
  } catch (e) {
    const message = (e as Error).message.split('\n')[0] || 'действие не выполнено'
    audit({ ...who(clientIp), action, target, result: 'error', details: { message } })
    return reply.code(message.includes('уже идёт') ? 409 : 500).send({ message })
  }
}

export async function wirelessRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  app.get('/api/wireless', async () => {
    const [adapter, paired, wifiState] = await Promise.all([bt.adapter(), bt.pairedDevices(), wifi.wifiStatus()])
    return { bluetooth: { adapter, paired, scanning: bt.isScanning() }, wifi: wifiState }
  })

  // ---------- Bluetooth ----------
  app.post<{ Body: { on: boolean } }>(
    '/api/wireless/bluetooth/power',
    { schema: { body: { type: 'object', required: ['on'], properties: { on: { type: 'boolean' } } } } },
    (req, reply) => act(req.clientIp, reply, `bluetooth.${req.body.on ? 'on' : 'off'}`, undefined, () => bt.setPower(req.body.on))
  )

  app.post('/api/wireless/bluetooth/scan', (req, reply) =>
    act(req.clientIp, reply, 'bluetooth.scan', undefined, async () => ({ found: await bt.scan20s() }))
  )

  // ---------- Wi-Fi (резервный канал; кабель остаётся основным) ----------
  app.post<{ Body: { on: boolean } }>(
    '/api/wireless/wifi/radio',
    { schema: { body: { type: 'object', required: ['on'], properties: { on: { type: 'boolean' } } } } },
    (req, reply) => act(req.clientIp, reply, `wifi.radio.${req.body.on ? 'on' : 'off'}`, undefined, () => wifi.setRadio(req.body.on))
  )

  app.post('/api/wireless/wifi/rescan', (req, reply) => act(req.clientIp, reply, 'wifi.rescan', undefined, () => wifi.rescan()))

  app.post<{ Body: { uuid: string } }>(
    '/api/wireless/wifi/connect-saved',
    { schema: { body: { type: 'object', required: ['uuid'], properties: { uuid: UUID } } } },
    (req, reply) => act(req.clientIp, reply, 'wifi.connect', req.body.uuid, () => wifi.connectSaved(req.body.uuid))
  )

  app.post<{ Body: { ssid: string; psk?: string } }>(
    '/api/wireless/wifi/connect',
    {
      schema: {
        body: {
          type: 'object',
          required: ['ssid'],
          properties: {
            ssid: { type: 'string', minLength: 1, maxLength: 32 },
            psk: { type: 'string', maxLength: 64 },
          },
        },
      },
    },
    // В журнал пишем только SSID: пароль в журнал не попадает
    (req, reply) => act(req.clientIp, reply, 'wifi.connect.new', req.body.ssid, () => wifi.connectNew(req.body.ssid, req.body.psk ?? ''))
  )

  app.post<{ Body: { uuid: string } }>(
    '/api/wireless/wifi/forget',
    { schema: { body: { type: 'object', required: ['uuid'], properties: { uuid: UUID } } } },
    (req, reply) => act(req.clientIp, reply, 'wifi.forget', req.body.uuid, () => wifi.forget(req.body.uuid))
  )

  app.post('/api/wireless/wifi/disconnect', (req, reply) => act(req.clientIp, reply, 'wifi.disconnect', undefined, () => wifi.disconnect()))
}
