import type { FastifyInstance } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import { getSetting, setSetting } from '../settings.js'

// Порядок блоков страниц (перетаскивание в интерфейсе). Общий для всех устройств: хранится в настройках панели
// ключом layout.<страница> как список id блоков. Неизвестные id при отображении игнорируются, новые блоки встают в конец.
const PAGE_RE = /^[a-z0-9-]{1,30}$/

export async function layoutRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { page: string } }>('/api/layout/:page', async (req, reply) => {
    if (!PAGE_RE.test(req.params.page)) return reply.code(400).send({ message: 'некорректное имя страницы' })
    return { order: getSetting<string[]>(`layout.${req.params.page}`, []) }
  })

  // Пустой список — сброс к порядку по умолчанию
  app.put<{ Params: { page: string }; Body: { order: string[] } }>(
    '/api/layout/:page',
    {
      schema: {
        body: {
          type: 'object',
          required: ['order'],
          properties: { order: { type: 'array', maxItems: 60, items: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' } } },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      if (!PAGE_RE.test(req.params.page)) return reply.code(400).send({ message: 'некорректное имя страницы' })
      setSetting(`layout.${req.params.page}`, req.body.order)
      audit({ ip: req.clientIp, user: 'admin', action: 'settings.layout', target: req.params.page, details: { blocks: req.body.order.length }, result: 'ok' })
      return { order: req.body.order }
    }
  )
}
