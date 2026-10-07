import { existsSync } from 'node:fs'
import path from 'node:path'
import fastifyCookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import Fastify, { LogController } from 'fastify'
import { authRoutes, cleanupAuth } from './auth.js'
import { startCollector, stopCollector } from './collector/index.js'
import { startDetectors } from './detectors.js'
import { startDiskIoCollector, stopDiskIoCollector } from './system/disk-io.js'
import { config } from './config.js'
import { db } from './db.js'
import { hasSecret, maskSecrets } from './mask.js'
import { scrubAuditSecrets } from './audit.js'
import { isAllowed, isInternal, normalizeIp } from './net.js'
import { serviceRoutes } from './routes/services.js'
import { aiRoutes } from './routes/ai.js'
import { wirelessRoutes } from './routes/wireless.js'
import { accessRoutes } from './routes/access.js'
import { auditRoutes } from './routes/audit.js'
import { layoutRoutes } from './routes/layout.js'
import { panelChangesRoutes } from './routes/panel-changes.js'
import { infraRoutes } from './routes/infra.js'
import { networkRoutes } from './routes/network.js'
import { notifyRoutes } from './routes/notify.js'
import { startNotifier } from './notifier.js'
import { startAlertIngest } from './services/alertEvents.js'
import { startDeadlines } from './services/deadlines.js'
import { startExchange } from './services/exchange.js'
import { startSpeedtest } from './services/speedtest.js'
import { startUpdates } from './services/updates.js'
import { killAllChildren } from './exec.js'
import { externalPolicy } from './externalPolicy.js'
import { externalEnabled, totpEnabled } from './security.js'
import { linksRoutes } from './routes/links.js'
import { securityRoutes } from './routes/security.js'
import { siteRoutes } from './routes/sites.js'
import { systemRoutes } from './routes/system.js'
import { uptimeRoutes } from './routes/uptime.js'

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    // Страховка: токены не попадают в журнал systemd ни из какого места кода
    hooks: {
      logMethod(args, method) {
        method.apply(this, args.map((a) => (typeof a === 'string' ? maskSecrets(a) : a && typeof a === 'object' && hasSecret(JSON.stringify(a)) ? JSON.parse(maskSecrets(JSON.stringify(a))) : a)) as Parameters<typeof method>)
      },
    },
  },
  // Без строки лога на каждый запрос — журнал systemd остаётся чистым
  logController: new LogController({ disableRequestLogging: true }),
  // Перед панелью может стоять nginx на этом же сервере (https://panel.pulsdev.net → 127.0.0.1:7575): заголовкам
  // X-Forwarded-* верим только от него, то есть от соединений с 127.0.0.1. Из LAN и VPN напрямую заголовки игнорируются.
  trustProxy: '127.0.0.1',
  bodyLimit: 64 * 1024,
})

app.decorateRequest('clientIp', '')

// Второй рубеж после ufw и nginx. Внутренние клиенты (LAN, WireGuard, localhost) — как раньше. Внешний клиент (адрес из
// X-Forwarded-For от доверенного локального nginx) допускается только если доступ из интернета включён в «Безопасности»
// (а он включается лишь при работающей 2FA); дальше действуют отдельные ограничения (см. externalPolicy).
app.addHook('onRequest', async (req, reply) => {
  req.clientIp = normalizeIp(req.ip)
  const viaProxy = normalizeIp(req.socket.remoteAddress) === '127.0.0.1'
  const deny = (text = 'Доступ только из локальной сети и VPN') => {
    req.log.warn({ ip: req.clientIp, url: req.url }, 'запрос из запрещённой сети отклонён')
    return reply.code(403).type('text/plain; charset=utf-8').send(text)
  }
  if (viaProxy && !isInternal(req)) {
    if (!externalEnabled()) return deny(totpEnabled() ? undefined : 'Сначала включите двухфакторный вход из домашней сети')
  } else if (!isAllowed(req.clientIp, config.allowedNets)) return deny()
})

// Что разрешено снаружи и проверка Origin у запросов с изменениями
app.addHook('onRequest', externalPolicy)

// Страховка: ни один JSON-ответ API не уходит с токеном внутри (текст ошибки, журнал и т.п.)
app.addHook('onSend', async (req, _reply, payload) => {
  if (req.url.startsWith('/api/') && typeof payload === 'string' && hasSecret(payload)) return maskSecrets(payload)
  return payload
})

app.addHook('onSend', async (_req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('X-Frame-Options', 'DENY')
  reply.header('Referrer-Policy', 'same-origin')
  reply.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  )
})

await app.register(fastifyCookie)
await app.register(authRoutes)
await app.register(securityRoutes)
await app.register(linksRoutes)
await app.register(systemRoutes)
await app.register(serviceRoutes)
await app.register(siteRoutes)
await app.register(accessRoutes)
await app.register(networkRoutes)
await app.register(auditRoutes)
await app.register(panelChangesRoutes)
await app.register(layoutRoutes)
await app.register(notifyRoutes)
await app.register(infraRoutes)
await app.register(uptimeRoutes)
await app.register(aiRoutes)
await app.register(wirelessRoutes)

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
    // wildcard: файлы ищутся на диске при каждом запросе — пересборка фронта подхватывается без перезапуска
    wildcard: true,
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
  // Отсутствующий файл (/assets/*.js, картинка и т.п.) — честный 404, а не index.html:
  // иначе браузер получает HTML вместо JS/CSS и показывает пустую страницу
  const pathOnly = req.url.split('?')[0]
  if (req.url.startsWith('/api/') || req.method !== 'GET' || !hasStatic || pathOnly.startsWith('/assets/') || /\.[a-z0-9]{2,5}$/i.test(pathOnly)) {
    return reply.code(404).send({ message: 'Не найдено' })
  }
  return reply.header('Cache-Control', 'no-cache').sendFile('index.html')
})

const cleanupTimer = setInterval(cleanupAuth, 60 * 60 * 1000)
cleanupAuth()

async function shutdown(signal: string) {
  app.log.info({ signal }, 'остановка')
  clearInterval(cleanupTimer)
  killAllChildren('SIGTERM') // дочерние процессы (du, smartctl, nmap…) не остаются сиротами
  stopCollector()
  stopDiskIoCollector()
  await app.close()
  db.close()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

if (!config.passwordHash) app.log.warn('PANEL_PASSWORD_HASH не задан — вход невозможен, запустите set-password')

await app.listen({ host: config.host, port: config.port })
// Коллектор стартует после API: его сбои не влияют на запуск сервера
startCollector(app.log)
startDiskIoCollector(app.log)
startDetectors(app.log)
startNotifier(app.log)
startDeadlines()
startUpdates()
startSpeedtest()
startExchange(app.log)
startAlertIngest(app.log, db)
{
  const n = scrubAuditSecrets()
  if (n) app.log.warn({ records: n }, 'из журнала действий убраны токены, попавшие туда до маскирования')
}
