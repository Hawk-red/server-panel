import { existsSync } from 'node:fs'
import path from 'node:path'
import fastifyCookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import Fastify, { LogController } from 'fastify'
import { authRoutes, cleanupAuth } from './auth.js'
import { config } from './config.js'
import { db } from './db.js'
import { isAllowed, normalizeIp } from './net.js'

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  // Без строки лога на каждый запрос — журнал systemd остаётся чистым
  logController: new LogController({ disableRequestLogging: true }),
  // Прокси перед панелью нет: IP берём только из сокета
  trustProxy: false,
  bodyLimit: 64 * 1024,
})

app.decorateRequest('clientIp', '')

// Второй рубеж после ufw: только LAN, WireGuard и localhost
app.addHook('onRequest', async (req, reply) => {
  req.clientIp = normalizeIp(req.socket.remoteAddress)
  if (!isAllowed(req.clientIp, config.allowedNets)) {
    req.log.warn({ ip: req.clientIp, url: req.url }, 'запрос из запрещённой сети отклонён')
    return reply.code(403).type('text/plain; charset=utf-8').send('Доступ только из локальной сети и VPN')
  }
})

app.addHook('onSend', async (_req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('X-Frame-Options', 'DENY')
  reply.header('Referrer-Policy', 'same-origin')
  reply.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://cdn.jsdelivr.net; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  )
})

await app.register(fastifyCookie)
await app.register(authRoutes)

app.get('/api/health', async () => ({
  status: 'ok',
  version: config.version,
  uptimeSec: Math.round(process.uptime()),
  node: process.versions.node,
  memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
}))

// Собранный фронт (SPA): неизвестные не-API пути → index.html
const hasStatic = existsSync(path.join(config.staticDir, 'index.html'))
if (hasStatic) {
  await app.register(fastifyStatic, {
    root: config.staticDir,
    wildcard: false,
    setHeaders: (res, filePath) => {
      res.header(
        'Cache-Control',
        filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'
      )
    },
  })
} else {
  app.log.warn({ staticDir: config.staticDir }, 'фронт не собран — отдаю только API')
}

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/') || req.method !== 'GET' || !hasStatic) {
    return reply.code(404).send({ message: 'Не найдено' })
  }
  return reply.header('Cache-Control', 'no-cache').sendFile('index.html')
})

const cleanupTimer = setInterval(cleanupAuth, 60 * 60 * 1000)
cleanupAuth()

async function shutdown(signal: string) {
  app.log.info({ signal }, 'остановка')
  clearInterval(cleanupTimer)
  await app.close()
  db.close()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

if (!config.passwordHash) app.log.warn('PANEL_PASSWORD_HASH не задан — вход невозможен, запустите set-password')

await app.listen({ host: config.host, port: config.port })
