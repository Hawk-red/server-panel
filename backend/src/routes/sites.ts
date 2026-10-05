import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth.js'
import * as sites from '../services/sites.js'
import * as tg from '../services/telegram.js'
import { ALERT_PERIODS, botsOverview } from '../services/bots.js'
import { panelBot } from '../services/panel-bot.js'

type Part<T> = { data: T; error: null } | { data: null; error: string }
async function part<T>(fn: () => Promise<T>): Promise<Part<T>> {
  try {
    return { data: await fn(), error: null }
  } catch (e) {
    const msg = (e as Error).message
    return { data: null, error: /password is required|not allowed/i.test(msg) ? 'нет прав (sudoers)' : msg }
  }
}

export async function siteRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  app.get('/api/sites', async () => {
    const [units, versions, sync, backup, exposure, pulsVersion, health, healthTls, cert] = await Promise.all([
      part(() => sites.unitsInfo(['nginx.service', 'php8.3-fpm.service', 'mariadb.service', 'mongod.service', 'pulsdev-api.service'])),
      part(sites.stackVersions),
      part(sites.lastSync),
      part(sites.prodCodeBackup),
      part(sites.mirrorExposure),
      part(sites.pulsdevVersion),
      part(sites.pulsdevHealth),
      part(sites.pulsdevHealthTls),
      part(sites.certificate),
    ])
    return { units, versions, sync, backup, exposure, pulsdev: { version: pulsVersion, health, healthTls, cert } }
  })

  // Тяжёлые части — отдельными запросами (WP-CLI, find)
  app.get('/api/sites/jetsetter/posts', async () => part(sites.recentPosts))
  app.get('/api/sites/jetsetter/files', async () => part(() => sites.recentFiles(3)))

  // Раздел «Telegram-боты» v2: реестр backend/bots.json
  // alertDays — период статистики Air Alert (белый список, иначе 30 дней)
  app.get<{ Querystring: { alertDays?: string } }>('/api/bots', async (req) => {
    const days = Number(req.query.alertDays)
    const period = ALERT_PERIODS.find((p) => p === days) ?? 30
    return [...(await botsOverview(period)), await panelBot()]
  })

  app.get('/api/telegram', async () => {
    const [units, alert, lead] = await Promise.all([
      part(() => sites.unitsInfo(['alert_monitor.service', 'pulsdev-api.service'])),
      part(tg.alertMonitor),
      part(tg.leadBot),
    ])
    return { units, alertMonitor: alert, leadBot: lead }
  })
}
