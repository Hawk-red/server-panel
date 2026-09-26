import type { FastifyInstance } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import { getSnapshot, SAMPLE_INTERVAL } from '../collector/index.js'
import { listSeriesNames, querySeries, RANGES, type Range } from '../collector/store.js'
import { listCron } from '../system/cron.js'
import { listDisks, refreshAllSmart } from '../system/disks.js'
import { listSources, readLog, type LogLevel } from '../system/logs.js'
import { ACTIONS, CONTROLLABLE, controlUnit, failedUnits, listAutostart, listServices, type UnitAction } from '../system/units.js'

// Сводка проблем для главной: только то, что реально требует внимания
async function collectProblems() {
  const snap = getSnapshot()
  const problems: { level: 'error' | 'warning'; text: string }[] = []
  const failed = await failedUnits().catch(() => null)
  if (failed === null) problems.push({ level: 'warning', text: 'Не удалось получить список упавших служб' })
  else for (const u of failed) problems.push({ level: 'error', text: `Служба ${u} упала` })
  for (const d of snap?.disks ?? []) {
    if (d.state === 'missing') problems.push({ level: 'error', text: `Диск ${d.mount} из fstab не подключён` })
    else if (d.percent !== null && d.percent > 85) problems.push({ level: 'warning', text: `Диск ${d.mount} заполнен на ${d.percent}%` })
    if (d.smart?.status === 'failing') problems.push({ level: 'error', text: `SMART: диск ${d.disk} (${d.model ?? '?'}) неисправен` })
    if (d.smart?.temperature != null && d.smart.temperature >= 55)
      problems.push({ level: 'warning', text: `Диск ${d.disk} нагрелся до ${d.smart.temperature} °C` })
  }
  const t = snap?.temperature?.cpu
  if (t != null && t >= 85) problems.push({ level: 'error', text: `Перегрев CPU: ${Math.round(t)} °C` })
  else if (t != null && t >= 75) problems.push({ level: 'warning', text: `CPU горячий: ${Math.round(t)} °C` })
  for (const [src, e] of Object.entries(snap?.errors ?? {})) {
    problems.push({ level: 'warning', text: `Нет данных от источника «${src}»: ${e!.message}` })
  }
  return problems
}

export async function systemRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  app.get('/api/system/snapshot', async () => ({ interval: SAMPLE_INTERVAL, snapshot: getSnapshot() }))

  app.get('/api/overview', async () => {
    const services = await listServices().catch(() => null)
    const main = services?.filter((s) => !s.background)
    return {
      snapshot: getSnapshot(),
      services: main
        ? {
            running: main.filter((s) => s.active === 'active').length,
            failed: main.filter((s) => s.active === 'failed').length,
            total: main.length,
          }
        : null,
      containers: await listAutostart()
        .then((a) => (a.containers ? { running: a.containers.filter((c) => c.state === 'running').length, total: a.containers.length } : null))
        .catch(() => null),
      devices: null, // этап 6
      torrents: null, // этап 3
      problems: await collectProblems(),
    }
  })

  app.get<{ Querystring: { series?: string; range?: string } }>('/api/metrics', async (req, reply) => {
    const range = (req.query.range ?? 'hour') as Range
    if (!RANGES.includes(range)) return reply.code(400).send({ message: 'неизвестный диапазон' })
    const names = (req.query.series ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30)
    return querySeries(names, range)
  })
  app.get('/api/metrics/names', async () => listSeriesNames())

  app.get('/api/system/disks', async () => listDisks())
  app.post('/api/system/disks/smart-refresh', async (req) => {
    await refreshAllSmart()
    audit({ ip: req.clientIp, user: 'admin', action: 'disks.smart-refresh', result: 'ok' })
    return listDisks()
  })

  app.get('/api/system/services', async () => listServices())
  app.post<{ Params: { unit: string; action: string } }>('/api/system/services/:unit/:action', async (req, reply) => {
    const { unit, action } = req.params
    if (!CONTROLLABLE[unit] || !ACTIONS.includes(action as UnitAction)) {
      audit({ ip: req.clientIp, user: 'admin', action: `service.${action}`, target: unit, result: 'denied' })
      return reply.code(403).send({ message: 'Эта служба или действие не разрешены' })
    }
    try {
      await controlUnit(unit, action as UnitAction)
      audit({ ip: req.clientIp, user: 'admin', action: `service.${action}`, target: unit, result: 'ok' })
      return { ok: true }
    } catch (e) {
      const message = (e as Error).message
      audit({ ip: req.clientIp, user: 'admin', action: `service.${action}`, target: unit, result: 'error', details: { message } })
      return reply.code(500).send({
        message: /password is required|not allowed/i.test(message) ? 'Нет прав: команда не разрешена в sudoers' : message,
      })
    }
  })

  app.get('/api/system/cron', async () => listCron())
  app.get('/api/system/autostart', async () => listAutostart())

  app.get('/api/logs/sources', async () => listSources())
  app.get<{ Querystring: { source: string; lines?: string; level?: string; q?: string } }>('/api/logs', async (req, reply) => {
    const level = req.query.level as LogLevel | undefined
    if (level && !['error', 'warning', 'info', 'debug'].includes(level)) return reply.code(400).send({ message: 'неизвестный уровень' })
    try {
      return await readLog(req.query.source, { lines: Number(req.query.lines ?? 200), level, q: req.query.q?.slice(0, 200) || undefined })
    } catch (e) {
      const err = e as Error & { statusCode?: number }
      return reply.code(err.statusCode ?? 500).send({ message: err.message })
    }
  })
}
