// Этап 10 (п.2): история доступности сервисов
import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth.js'
import { monitorBars } from '../services/uptime.js'

export async function uptimeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)
  app.get('/api/uptime', async () => ({ generatedAt: Date.now(), monitors: monitorBars() }))
}
