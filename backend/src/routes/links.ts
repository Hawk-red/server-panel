import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth.js'
import { isInternal } from '../net.js'
import { linksFor } from '../services/links.js'

export async function linksRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)
  // Адреса веб-интерфейсов служб; снаружи все null (доступны только из дома или через WireGuard)
  app.get('/api/links', async (req) => linksFor(isInternal(req)))
}
