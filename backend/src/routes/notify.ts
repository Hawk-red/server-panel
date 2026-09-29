import type { FastifyInstance } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import { errText } from '../mask.js'
import * as n from '../notifier.js'
import { panelBotMe } from '../services/panel-bot.js'

export async function notifyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  app.get('/api/notify', async () => ({ ...(await n.notifyStatus()), bot: await n.botInfo() }))

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
      return reply.code(400).send({ message: errText(e) })
    }
  })

  // Проверка связи с Telegram (getMe) без отправки сообщений; сбрасывает кэш карточки бота
  app.post('/api/notify/check', async () => {
    const me = await panelBotMe(true)
    return { ok: Boolean(me.value), username: me.value?.username ?? null, error: me.error }
  })

  // Тест в выбранный чат; с телом { chatId } — проверка произвольного чата (группа — отрицательное число) до сохранения
  app.post<{ Body: { chatId?: number } | undefined }>(
    '/api/notify/test',
    { schema: { body: { type: ['object', 'null'], properties: { chatId: { type: 'integer' } } } } },
    async (req, reply) => {
      const chatId = req.body?.chatId
      try {
        const chat = await n.sendTest(chatId)
        audit({ ip: req.clientIp, user: 'admin', action: 'notify.test', target: String(chat.id), details: { type: chat.type, name: chat.name }, result: 'ok' })
        return { ok: true, chat }
      } catch (e) {
        audit({ ip: req.clientIp, user: 'admin', action: 'notify.test', target: chatId != null ? String(chatId) : undefined, result: 'error', details: { message: errText(e) } })
        return reply.code(400).send({ message: errText(e) })
      }
    }
  )
}
