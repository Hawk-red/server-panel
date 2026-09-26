import { db } from '../db.js'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// Хранение: сырые — 48 ч, средние по 5 мин — 14 дней, по часу — 400 дней
const RETENTION = { raw: 48 * HOUR, m5: 14 * DAY, h1: 400 * DAY }

const insertRaw = db.prepare('INSERT INTO metric_raw (ts, name, value) VALUES (?, ?, ?)')
const insertMany = db.transaction((ts: number, values: Record<string, number>) => {
  for (const [name, value] of Object.entries(values)) {
    if (Number.isFinite(value)) insertRaw.run(ts, name, value)
  }
})

export function writeSample(ts: number, values: Record<string, number>) {
  insertMany(ts, values)
}

// Готовые почасовые значения (например, статистика AdGuard) — сразу в metric_1h
const upsertHourly = db.prepare('INSERT OR REPLACE INTO metric_1h (ts, name, avg, max) VALUES (?, ?, ?, ?)')
export const writeHourly = db.transaction((name: string, points: [number, number][]) => {
  for (const [ts, v] of points) if (Number.isFinite(v)) upsertHourly.run(ts, name, v, v)
})

// Серии, которые существуют только в почасовой таблице
const HOURLY_ONLY = (name: string) => name.startsWith('adguard.')

const rollup5m = db.prepare(`
  INSERT OR REPLACE INTO metric_5m (ts, name, avg, max)
  SELECT (ts / 300000) * 300000 AS b, name, AVG(value), MAX(value)
  FROM metric_raw WHERE ts >= ? AND ts < ? GROUP BY b, name`)
const rollup1h = db.prepare(`
  INSERT OR REPLACE INTO metric_1h (ts, name, avg, max)
  SELECT (ts / 3600000) * 3600000 AS b, name, AVG(avg), MAX(max)
  FROM metric_5m WHERE ts >= ? AND ts < ? GROUP BY b, name`)
const pruneRaw = db.prepare('DELETE FROM metric_raw WHERE ts < ?')
const prune5m = db.prepare('DELETE FROM metric_5m WHERE ts < ?')
const prune1h = db.prepare('DELETE FROM metric_1h WHERE ts < ?')

// Пересчитываем последние завершённые интервалы (с запасом — идемпотентно)
export function rollupAndPrune(now = Date.now()) {
  const end5 = Math.floor(now / (5 * MIN)) * 5 * MIN
  rollup5m.run(end5 - 30 * MIN, end5)
  const endH = Math.floor(now / HOUR) * HOUR
  rollup1h.run(endH - 3 * HOUR, endH)
  pruneRaw.run(now - RETENTION.raw)
  prune5m.run(now - RETENTION.m5)
  prune1h.run(now - RETENTION.h1)
}

export type Range = 'hour' | 'day' | 'week' | 'month' | 'quarter'

// Диапазон → таблица и шаг усреднения (≈ 120–720 точек на график)
const PLAN: Record<Range, { span: number; table: 'metric_raw' | 'metric_5m' | 'metric_1h'; step: number }> = {
  hour: { span: HOUR, table: 'metric_raw', step: 0 },
  day: { span: DAY, table: 'metric_raw', step: 5 * MIN },
  week: { span: 7 * DAY, table: 'metric_5m', step: 30 * MIN },
  month: { span: 30 * DAY, table: 'metric_1h', step: HOUR },
  quarter: { span: 90 * DAY, table: 'metric_1h', step: 3 * HOUR },
}

export const RANGES = Object.keys(PLAN) as Range[]

export function querySeries(names: string[], range: Range, now = Date.now()) {
  const plan = PLAN[range]
  const from = now - plan.span
  const col = plan.table === 'metric_raw' ? 'value' : 'avg'
  const colMax = plan.table === 'metric_raw' ? 'value' : 'max'
  const sql =
    plan.step === 0
      ? `SELECT ts AS t, ${col} AS v, ${colMax} AS m FROM ${plan.table} WHERE name = ? AND ts >= ? ORDER BY ts`
      : `SELECT (ts / ${plan.step}) * ${plan.step} AS t, AVG(${col}) AS v, MAX(${colMax}) AS m
         FROM ${plan.table} WHERE name = ? AND ts >= ? GROUP BY t ORDER BY t`
  const stmt = db.prepare(sql)
  const hourStep = Math.max(plan.step, HOUR)
  const hourlyStmt = db.prepare(
    `SELECT (ts / ${hourStep}) * ${hourStep} AS t, SUM(avg) AS v, MAX(max) AS m FROM metric_1h WHERE name = ? AND ts >= ? GROUP BY t ORDER BY t`
  )
  const out: Record<string, [number, number, number][]> = {}
  for (const name of names) {
    const rows = (HOURLY_ONLY(name) ? hourlyStmt : stmt).all(name, from) as { t: number; v: number; m: number }[]
    out[name] = rows.map((r) => [
      r.t,
      Math.round(r.v * 100) / 100,
      Math.round(r.m * 100) / 100,
    ])
  }
  return { range, from, to: now, step: plan.step || 30_000, series: out }
}

export function listSeriesNames(): string[] {
  const since = Date.now() - HOUR
  return (db.prepare('SELECT DISTINCT name FROM metric_raw WHERE ts >= ? ORDER BY name').all(since) as { name: string }[]).map(
    (r) => r.name
  )
}
