import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth.js'
import * as sites from '../services/sites.js'
import * as tg from '../services/telegram.js'

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
    const [units, versions, sync, backup, exposure, pulsVersion, health, healthTls, cert, filebrowser] = await Promise.all([
      part(() => sites.unitsInfo(['nginx.service', 'php8.3-fpm.service', 'mariadb.service', 'mongod.service', 'pulsdev-api.service'])),
      part(sites.stackVersions),
      part(sites.lastSync),
      part(sites.prodCodeBackup),
      part(sites.mirrorExposure),
      part(sites.pulsdevVersion),
      part(sites.pulsdevHealth),
      part(sites.pulsdevHealthTls),
      part(sites.certificate),
      part(sites.filebrowserState),
    ])
    return { units, versions, sync, backup, exposure, pulsdev: { version: pulsVersion, health, healthTls, cert }, filebrowser }
  })

  // Тяжёлые части — отдельными запросами (WP-CLI, find)
  app.get('/api/sites/jetsetter/posts', async () => part(sites.recentPosts))
  app.get('/api/sites/jetsetter/files', async () => part(() => sites.recentFiles(3)))

  app.get('/api/telegram', async () => {
    const [units, alert, lead] = await Promise.all([
      part(() => sites.unitsInfo(['alert_monitor.service', 'pulsdev-api.service'])),
      part(tg.alertMonitor),
      part(tg.leadBot),
    ])
    return { units, alertMonitor: alert, leadBot: lead }
  })
}
