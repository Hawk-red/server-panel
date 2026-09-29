// Этап 10 (п.2): история доступности сервисов — полоски 24 ч / 7 дней, как в Uptime Kuma.
// Вместо отдельного heartbeat-опроса переиспользуем уже существующие источники:
//  - события unit.failed/unit.recovered и container.stopped/started/restart (detectors.ts) — падения служб и контейнеров;
//  - «дыры» в metric_raw/metric_5m (коллектор пишет раз в 30 с) — если сервера не было в сети вовсе
//    (перезагрузка, зависание), это падение всех сервисов сразу, даже если детекторы сами не работали в этот момент.
import { db } from '../db.js'

type Interval = [number, number]

const HOUR = 3_600_000
const DAY = 24 * HOUR

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (!intervals.length) return []
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  const out: Interval[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1]
    const cur = sorted[i]
    if (cur[0] <= last[1]) last[1] = Math.max(last[1], cur[1])
    else out.push(cur)
  }
  return out
}

// Переходы down/up по конкретному target: события до `from` только уточняют начальное состояние,
// в интервалы попадает лишь то, что пересекается с [from, to].
function downUpIntervals(target: string, downKind: string, upKind: string, from: number, to: number): Interval[] {
  const rows = db
    .prepare(`SELECT ts, kind FROM events WHERE target = ? AND kind IN (?, ?) AND ts <= ? ORDER BY ts ASC`)
    .all(target, downKind, upKind, to) as { ts: number; kind: string }[]
  const intervals: Interval[] = []
  let downSince: number | null = null
  for (const r of rows) {
    if (r.ts < from) {
      downSince = r.kind === downKind ? r.ts : null
      continue
    }
    if (r.kind === downKind) {
      if (downSince === null) downSince = r.ts
    } else if (downSince !== null) {
      intervals.push([Math.max(downSince, from), r.ts])
      downSince = null
    }
  }
  if (downSince !== null) intervals.push([Math.max(downSince, from), to])
  return intervals
}

function unitDownIntervals(unit: string, from: number, to: number): Interval[] {
  return downUpIntervals(unit, 'unit.failed', 'unit.recovered', from, to)
}

// Детектор контейнеров пишет ещё и container.restart, когда контейнер успел остановиться и
// подняться в промежутке между двумя опросами (раз в минуту) — считаем это мгновенным простоем в 1 тик.
function containerDownIntervals(name: string, from: number, to: number): Interval[] {
  const base = downUpIntervals(name, 'container.stopped', 'container.started', from, to)
  const restarts = db
    .prepare(`SELECT ts FROM events WHERE target = ? AND kind = 'container.restart' AND ts >= ? AND ts <= ?`)
    .all(name, from - 60_000, to) as { ts: number }[]
  const blips = restarts.map((r): Interval => [Math.max(from, r.ts - 60_000), Math.min(to, r.ts)]).filter(([s, e]) => e > s)
  return mergeIntervals([...base, ...blips])
}

// «Дыры» в метриках — сервер целиком не отвечал (выключен/перезагружался/завис).
// Сырые данные (30 с) есть только за 48 ч, дальше используем 5-минутные срезы с более широким порогом.
function gapsFromTable(table: 'metric_raw' | 'metric_5m', from: number, to: number, thresholdMs: number): Interval[] {
  if (to <= from) return []
  const rows = db.prepare(`SELECT DISTINCT ts FROM ${table} WHERE ts >= ? AND ts <= ? ORDER BY ts ASC`).all(from - thresholdMs, to) as { ts: number }[]
  if (!rows.length) return []
  const gaps: Interval[] = []
  if (rows[0].ts - from > thresholdMs) gaps.push([from, Math.min(rows[0].ts, to)])
  for (let i = 1; i < rows.length; i++) {
    const gap = rows[i].ts - rows[i - 1].ts
    if (gap > thresholdMs) gaps.push([Math.max(rows[i - 1].ts, from), Math.min(rows[i].ts, to)])
  }
  return gaps.filter(([s, e]) => e > s)
}

function globalOutages(from: number, to: number): Interval[] {
  const rawFrom = Math.max(from, to - 48 * HOUR)
  const rawGaps = gapsFromTable('metric_raw', rawFrom, to, 150_000) // сэмплы раз в 30 с — порог 2.5 мин
  const m5To = Math.min(to, rawFrom)
  const m5Gaps = gapsFromTable('metric_5m', from, m5To, 20 * 60_000) // 5-минутные срезы — порог 20 мин
  return mergeIntervals([...m5Gaps, ...rawGaps])
}

// Самая ранняя точка, откуда вообще есть какие-то метрики — до неё бары «нет данных», а не «упало».
function dataSince(): number {
  const row = db.prepare('SELECT MIN(ts) AS ts FROM metric_raw').get() as { ts: number | null }
  return row.ts ?? Date.now()
}

type MonitorKind = 'unit' | 'container' | 'composite' | 'server'
type MonitorDef = { id: string; title: string; group: string; kind: MonitorKind; target?: string; parts?: string[] }

export const MONITORS: MonitorDef[] = [
  { id: 'server', title: 'Сервер (аптайм)', group: 'Сервер', kind: 'server' },
  { id: 'nginx', title: 'nginx', group: 'Службы', kind: 'unit', target: 'nginx.service' },
  { id: 'php-fpm', title: 'PHP-FPM 8.3', group: 'Службы', kind: 'unit', target: 'php8.3-fpm.service' },
  { id: 'mariadb', title: 'MariaDB', group: 'Службы', kind: 'unit', target: 'mariadb.service' },
  { id: 'mongod', title: 'MongoDB', group: 'Службы', kind: 'unit', target: 'mongod.service' },
  { id: 'fail2ban', title: 'fail2ban', group: 'Службы', kind: 'unit', target: 'fail2ban.service' },
  { id: 'cron', title: 'cron', group: 'Службы', kind: 'unit', target: 'cron.service' },
  { id: 'qbittorrent', title: 'qBittorrent', group: 'Контейнеры', kind: 'container', target: 'qbittorrent' },
  { id: 'adguardhome', title: 'AdGuard Home', group: 'Контейнеры', kind: 'container', target: 'adguardhome' },
  { id: 'jellyfin', title: 'Jellyfin', group: 'Контейнеры', kind: 'container', target: 'jellyfin' },
  { id: 'sftpgo', title: 'SFTPGo (обменник)', group: 'Контейнеры', kind: 'container', target: 'sftpgo' },
  { id: 'minimserver', title: 'MinimServer', group: 'Контейнеры', kind: 'container', target: 'minimserver' },
  { id: 'bubbleupnpserver', title: 'BubbleUPnP Server', group: 'Контейнеры', kind: 'container', target: 'bubbleupnpserver' },
  { id: 'portainer', title: 'Portainer', group: 'Контейнеры', kind: 'container', target: 'portainer' },
  { id: 'docker-socket-proxy', title: 'docker-socket-proxy', group: 'Контейнеры', kind: 'container', target: 'docker-socket-proxy' },
  { id: 'jetsetter', title: 'Зеркало jetsetter', group: 'Сайты и API', kind: 'composite', parts: ['nginx.service', 'php8.3-fpm.service', 'mariadb.service', 'mongod.service'] },
  { id: 'pulsdev-api', title: 'api.pulsdev.net', group: 'Сайты и API', kind: 'unit', target: 'pulsdev-api.service' },
]

function specificDown(m: MonitorDef, from: number, to: number): Interval[] {
  if (m.kind === 'unit') return unitDownIntervals(m.target!, from, to)
  if (m.kind === 'container') return containerDownIntervals(m.target!, from, to)
  if (m.kind === 'composite') return mergeIntervals(m.parts!.flatMap((p) => unitDownIntervals(p, from, to)))
  return []
}

export type BarStatus = 'up' | 'partial' | 'down' | 'unknown'
export type UptimeBar = { ts: number; status: BarStatus; downPct: number }
export type MonitorBars = { id: string; title: string; group: string; day: UptimeBar[]; week: UptimeBar[]; upDay: number | null; upWeek: number | null }

function bucketize(down: Interval[], start: number, end: number, since: number): UptimeBar {
  if (end <= since) return { ts: start, status: 'unknown', downPct: 0 }
  const knownStart = Math.max(start, since)
  const knownDur = end - knownStart
  let downMs = 0
  for (const [s, e] of down) {
    const os = Math.max(s, knownStart)
    const oe = Math.min(e, end)
    if (oe > os) downMs += oe - os
  }
  const pct = knownDur > 0 ? downMs / knownDur : 0
  const status: BarStatus = pct <= 0.001 ? 'up' : pct >= 0.999 ? 'down' : 'partial'
  return { ts: start, status, downPct: Math.round(pct * 1000) / 10 }
}

function upPct(bars: UptimeBar[]): number | null {
  const known = bars.filter((b) => b.status !== 'unknown')
  if (!known.length) return null
  const avgDown = known.reduce((s, b) => s + b.downPct, 0) / known.length
  return Math.round((100 - avgDown) * 10) / 10
}

export function monitorBars(now = Date.now()): MonitorBars[] {
  const weekFrom = now - 7 * DAY
  const since = dataSince()
  const outages = globalOutages(weekFrom, now)

  return MONITORS.map((m) => {
    const down = m.kind === 'server' ? outages : mergeIntervals([...specificDown(m, weekFrom, now), ...outages])

    const day: UptimeBar[] = []
    for (let i = 23; i >= 0; i--) {
      const end = now - i * HOUR
      day.push(bucketize(down, end - HOUR, end, since))
    }
    const week: UptimeBar[] = []
    for (let i = 6; i >= 0; i--) {
      const end = now - i * DAY
      week.push(bucketize(down, end - DAY, end, since))
    }
    return { id: m.id, title: m.title, group: m.group, day, week, upDay: upPct(day), upWeek: upPct(week) }
  })
}
