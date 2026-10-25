import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth.js'
import { pageStatus } from '../services/haPage.js'

// Страница «Home Assistant»: только состояние связи и сводка синхронизации. Управления здесь нет —
// переключатели и сцены остаются на «Умном доме», ссылки на сам HA строит общий реестр ссылок (services/links.ts).
export async function homeassistantRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)
  app.get('/api/homeassistant/status', async () => pageStatus())
}
