import type { FastifyInstance } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import * as n from '../notifier.js'

export async function notifyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  app.get('/api/notify', async () => ({ ...n.notifyStatus(), bot: await n.botInfo() }))

  app.put<{ Body: n.NotifySettings }>(
    '/api/notify',
    {
      schema: {
        body: {
          type: 'object',
          required: ['chatId', 'enabled', 'quiet', 'rules'],
          properties: {
            chatId: { type: ['integer', 'null'] },
            enabled: { type: 'boolean' },
            quiet: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string', pattern: '^\\d{2}:\\d{2}$' }, to: { type: 'string', pattern: '^\\d{2}:\\d{2}$' } } },
            rules: { type: 'object', additionalProperties: { type: 'boolean' } },
          },
        },
      },
    },
    async (req) => {
      n.saveNotifySettings(req.body)
      audit({ ip: req.clientIp, user: 'admin', action: 'settings.notify', details: { chatId: req.body.chatId, enabled: req.body.enabled, quiet: req.body.quiet }, result: 'ok' })
      return { ok: true }
    }
  )

  app.post('/api/notify/detect-chat', async (_req, reply) => {
    try {
      return await n.detectChats()
    } catch (e) {
      return reply.code(400).send({ message: (e as Error).message })
    }
  })

  app.post('/api/notify/test', async (req, reply) => {
    try {
      await n.sendTest()
      audit({ ip: req.clientIp, user: 'admin', action: 'notify.test', result: 'ok' })
      return { ok: true }
    } catch (e) {
      audit({ ip: req.clientIp, user: 'admin', action: 'notify.test', result: 'error', details: { message: (e as Error).message } })
      return reply.code(400).send({ message: (e as Error).message })
    }
  })
}
