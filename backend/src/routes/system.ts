import type { FastifyInstance } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import { getSnapshot, SAMPLE_INTERVAL } from '../collector/index.js'
import { listDevices, summary as networkSummary } from '../network/scanner.js'
import { summary as torrentSummary } from '../services/qbittorrent.js'
import { listSeriesNames, querySeries, RANGES, type Range } from '../collector/store.js'
import { listCron } from '../system/cron.js'
import { listDisks, refreshAllSmart } from '../system/disks.js'
import { listSources, readLog, type LogLevel } from '../system/logs.js'
import { run } from '../exec.js'
import { ACTIONS, CONTROLLABLE, controlUnit, failedUnits, listAutostart, listServices, type UnitAction } from '../system/units.js'

// Сводка проблем для главной: только то, что реально требует внимания.
// kind + ref позволяют открыть по проблеме диагностику (лог, статус, переход в раздел).
type Problem = { level: 'error' | 'warning'; text: string; kind: 'unit' | 'disk' | 'smart' | 'temp' | 'devices' | 'source'; ref: string; link: string }

async function collectProblems(): Promise<Problem[]> {
  const snap = getSnapshot()
  const problems: Problem[] = []
  const failed = await failedUnits().catch(() => null)
  if (failed === null) problems.push({ level: 'warning', text: 'Не удалось получить список упавших служб', kind: 'source', ref: 'systemd', link: '/system?tab=services' })
  else for (const u of failed) problems.push({ level: 'error', text: `Служба ${u} упала`, kind: 'unit', ref: u, link: `/system?tab=services` })
  for (const d of snap?.disks ?? []) {
    const link = '/system?tab=disks'
    if (d.state === 'missing') problems.push({ level: 'error', text: `Диск ${d.mount} из fstab не подключён`, kind: 'disk', ref: d.mount ?? d.device, link })
    // Шкала этапа 8: > 85% — красная зона (ошибка); 70–85% — только жёлтый цвет, не проблема
    else if (d.percent !== null && d.percent > 85) problems.push({ level: 'error', text: `Диск ${d.mount} заполнен на ${Math.round(d.percent)}%`, kind: 'disk', ref: d.mount ?? d.device, link })
    if (d.smart?.status === 'failing') problems.push({ level: 'error', text: `SMART: диск ${d.disk} (${d.model ?? '?'}) неисправен`, kind: 'smart', ref: d.disk, link })
    if (d.smart?.temperature != null && d.smart.temperature > 55)
      problems.push({ level: 'warning', text: `Диск ${d.disk} нагрелся до ${d.smart.temperature} °C`, kind: 'smart', ref: d.disk, link })
  }
  const t = snap?.temperature?.cpu
  if (t != null && t > 85) problems.push({ level: 'error', text: `Перегрев CPU: ${Math.round(t)} °C`, kind: 'temp', ref: 'cpu', link: '/system?tab=resources' })
  else if (t != null && t >= 70) problems.push({ level: 'warning', text: `CPU горячий: ${Math.round(t)} °C`, kind: 'temp', ref: 'cpu', link: '/system?tab=resources' })
  const net = networkSummary()
  if (net.unknown > 0)
    problems.push({ level: 'warning', text: `В сети ${net.unknown} неизвестн. устройств(а) — подпишите их в «Сеть и устройства»`, kind: 'devices', ref: 'unknown', link: '/network' })
  for (const [src, e] of Object.entries(snap?.errors ?? {})) {
    problems.push({ level: 'warning', text: `Нет данных от источника «${src}»: ${e!.message}`, kind: 'source', ref: src, link: SOURCE_LINK[src] ?? '/system' })
  }
  return problems
}

const SOURCE_LINK: Record<string, string> = {
  qbittorrent: '/torrents',
  adguard: '/adguard',
  network: '/network',
  smart: '/system?tab=disks',
  disks: '/system?tab=disks',
  temperature: '/system?tab=resources',
}

// Диагностика по проблеме: статус + последние строки лога + готовый текст для чата с Claude
async function diagnose(kind: string, ref: string) {
  const now = new Date()
  let status = ''
  let logSource: string | null = null
  let lines: string[] = []
  const tail = async (id: string, n: number) =>
    (await readLog(id, { lines: n }).catch(() => ({ lines: [] as { ts: number | null; text: string }[] }))).lines.map(
      (l) => `${l.ts ? new Date(l.ts).toLocaleString('ru-RU') + '  ' : ''}${l.text}`
    )
  if (kind === 'unit') {
    if (!/^[\w@.:-]+$/.test(ref)) throw Object.assign(new Error('некорректное имя юнита'), { statusCode: 400 })
    status = await run('/usr/bin/systemctl', ['status', ref, '--no-pager', '-n', '0']).catch((e) => (e.stdout as string) || (e.message as string))
    logSource = `journal:${ref}`
    lines = await tail(logSource, 100)
  } else if (kind === 'disk' || kind === 'smart') {
    const d = (getSnapshot()?.disks ?? []).find((x) => x.mount === ref || x.disk === ref || x.device === ref)
    status = d
      ? [
          `Устройство: ${d.device} (${d.model ?? 'модель неизвестна'}), ФС ${d.fstype ?? '?'}, точка ${d.mount ?? '—'}`,
          `Состояние: ${d.state}; занято ${d.percent ?? '?'}%`,
          `SMART: ${d.smart ? `${d.smart.status}${d.smart.temperature != null ? `, ${d.smart.temperature} °C` : ''}${d.smart.error ? `, ${d.smart.error}` : ''}` : 'нет данных'}`,
        ].join('\n')
      : `Диск ${ref}: нет данных в снимке`
    status += '\n\n' + (await run('/usr/bin/df', ['-h', '--output=source,fstype,size,used,avail,pcent,target']).catch(() => ''))
    logSource = 'file:/home/hawk/disk-monitor.log'
    lines = await tail(logSource, 100)
  } else if (kind === 'temp') {
    const s = getSnapshot()
    status = `CPU ${s?.temperature?.cpu ?? '?'} °C (ядра: ${s?.temperature?.cores.join(', ') ?? '?'}), вентилятор ${s?.fan?.rpm ?? '?'} об/мин, load ${s?.load ? `${s.load.l1} / ${s.load.l5} / ${s.load.l15}` : '?'}`
    logSource = 'journal:thermal-watchdog.service'
    lines = await tail(logSource, 100)
  } else if (kind === 'devices') {
    const devs = listDevices().filter((d) => !d.known)
    status = devs.map((d) => `${d.ip}  ${d.mac}  ${d.vendor ?? (d.randomMac ? 'случайный MAC' : '?')}  ${d.hostname ?? ''}`).join('\n')
  } else {
    const e = getSnapshot()?.errors[ref as keyof NonNullable<ReturnType<typeof getSnapshot>>['errors']]
    status = e ? `Источник «${ref}» недоступен с ${new Date(e.since).toLocaleString('ru-RU')}: ${e.message}` : `Источник «${ref}»: ошибок сейчас нет`
    logSource = 'journal:server-panel.service'
    lines = (await tail(logSource, 300)).filter((l) => l.includes(ref)).slice(-100)
  }
  const copy = [
    `Проблема на сервере Mac Mini (панель, ${now.toLocaleString('ru-RU')})`,
    `Тип: ${kind}, объект: ${ref}`,
    '',
    '--- Статус ---',
    status.trim() || '(нет)',
    '',
    `--- Последние ${Math.min(50, lines.length)} строк лога${logSource ? ` (${logSource})` : ''} ---`,
    ...lines.slice(-50),
  ].join('\n')
  return { kind, ref, status, logSource, lines, copy }
}

export async function systemRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  app.get<{ Querystring: { kind?: string; ref?: string } }>('/api/diagnostics', async (req, reply) => {
    const { kind, ref } = req.query
    if (!kind || !ref || !['unit', 'disk', 'smart', 'temp', 'devices', 'source'].includes(kind)) return reply.code(400).send({ message: 'нужны kind и ref' })
    try {
      return await diagnose(kind, ref)
    } catch (e) {
      const err = e as Error & { statusCode?: number }
      return reply.code(err.statusCode ?? 500).send({ message: err.message })
    }
  })

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
      devices: networkSummary(),
      torrents: await torrentSummary()
        .then((t) => ({ active: t.active.length, downloading: t.counts.downloading, seeding: t.counts.seeding }))
        .catch(() => null),
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
