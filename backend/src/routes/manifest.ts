import type { FastifyInstance } from 'fastify'
import { MANIFEST_PATH, manifestFor } from '../manifest.js'

// Манифест PWA. Без входа — и это осознанное исключение (см. PUBLIC_PATHS в auth.ts): браузер запрашивает
// <link rel="manifest"> без cookie сессии, а внутри манифеста нет ничего секретного (иконки, цвета, путь страницы).
// Маршрут перекрывает одноимённый статичный файл из сборки фронта; без параметров отдаёт то же самое (start_url «/»).
export async function manifestRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { start?: unknown; name?: unknown } }>(MANIFEST_PATH, async (req, reply) =>
    reply
      .type('application/manifest+json; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(JSON.stringify(manifestFor(req.query.start, req.query.name), null, 2))
  )
}
