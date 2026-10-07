// Статистика обстрелов: инкрементальное чтение логов alert_monitor → таблица alert_events.
// Логи ротируются (5 МБ × 3), поэтому события копим в БД, а не пересчитываем из логов на лету.
import { createHash } from 'node:crypto'
import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import type { FastifyBaseLogger } from 'fastify'
import type Database from 'better-sqlite3'
import { classifyAlert, CLASSIFIER_VERSION } from './alertClassifier.js'

export const ALERT_LOG = '/opt/alert_monitor/alert_monitor.log'
const STATE_KEY = 'alert_ingest_state'
const ROTATED = [3, 2, 1] // от старых к новым

export interface RawAlert {
  ts: number
  day: string
  reason: string
  text: string
}

const HEADER = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d),(\d{3}) \[\w+\] (.*)$/
// Два формата: актуальный "[poll] СОВПАДЕНИЕ (причина): текст" и старый "ОБНАРУЖЕНО СОВПАДЕНИЕ (ключ: …): текст" (до 30.07.2026)
const MATCH = /^(?:\[poll\] СОВПАДЕНИЕ \(([^)]*)\)|ОБНАРУЖЕНО СОВПАДЕНИЕ \(([^)]*)\)): (.*)$/s

function readFrom(file: string, offset: number): Buffer {
  const size = statSync(file).size
  if (offset >= size) return Buffer.alloc(0)
  const buf = Buffer.alloc(size - offset)
  const fd = openSync(file, 'r')
  try {
    let got = 0
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, offset + got)
      if (n <= 0) break
      got += n
    }
    return buf.subarray(0, got)
  } finally {
    closeSync(fd)
  }
}

/**
 * Разбор файла с позиции offset. Запись многострочная (текст сообщения может содержать переводы строк), поэтому запись
 * считается законченной только когда встретилась следующая строка с временной меткой.
 * Не законченная запись в конце файла (final=false) не отдаётся, а nextOffset указывает на её начало — следующий проход прочтёт её целиком.
 */
export function scanLog(file: string, offset: number, final: boolean): { records: RawAlert[]; nextOffset: number } {
  const buf = readFrom(file, offset)
  let end = buf.lastIndexOf(0x0a) + 1 // только полные строки
  if (final && end < buf.length) end = buf.length
  const records: RawAlert[] = []
  let cur: (RawAlert & { start: number }) | null = null
  const flush = () => {
    if (cur) {
      const { start: _s, ...rec } = cur
      rec.text = rec.text.replace(/\s+$/, '')
      records.push(rec)
      cur = null
    }
  }
  let pos = 0
  while (pos < end) {
    let nl = buf.indexOf(0x0a, pos)
    if (nl < 0 || nl >= end) nl = end
    const line = buf.subarray(pos, nl).toString('utf8').replace(/\r$/, '')
    const h = HEADER.exec(line)
    if (h) {
      flush()
      const m = MATCH.exec(h[4])
      if (m) {
        const ts = new Date(`${h[1]}T${h[2]}.${h[3]}`).getTime()
        cur = { start: offset + pos, ts, day: h[1], reason: m[1] ?? m[2] ?? '', text: m[3] }
      }
    } else if (cur) {
      cur.text += '\n' + line
    }
    pos = nl + 1
  }
  if (cur) {
    const pending = cur as RawAlert & { start: number }
    if (final) flush()
    else return { records, nextOffset: pending.start }
  }
  return { records, nextOffset: offset + end }
}

const hashOf = (ts: number, text: string) => createHash('sha1').update(`${ts}\n${text}`).digest('hex')

export function storeAlerts(db: Database.Database, records: RawAlert[]): number {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO alert_events (ts, day, text, categories, reason, text_hash, classifier_version, is_missile, ignored, ignore_reason, takeoff)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  let added = 0
  db.transaction(() => {
    for (const r of records) {
      const c = classifyAlert(r.text)
      added += ins.run(
        r.ts, r.day, r.text, c.ignored ? 'ignored' : c.categories.join(','), r.reason, hashOf(r.ts, r.text),
        CLASSIFIER_VERSION, c.isMissile ? 1 : 0, c.ignored ? 1 : 0, c.ignoreReason, c.takeoff ? 1 : 0
      ).changes
    }
  })()
  return added
}

// Пересчёт старых записей по сохранённому тексту, если версия классификатора выросла
export function reclassifyOld(db: Database.Database): number {
  const rows = db.prepare('SELECT id, text FROM alert_events WHERE classifier_version < ?').all(CLASSIFIER_VERSION) as { id: number; text: string }[]
  const upd = db.prepare('UPDATE alert_events SET categories=?, is_missile=?, ignored=?, ignore_reason=?, takeoff=?, classifier_version=? WHERE id=?')
  db.transaction(() => {
    for (const r of rows) {
      const c = classifyAlert(r.text)
      upd.run(c.ignored ? 'ignored' : c.categories.join(','), c.isMissile ? 1 : 0, c.ignored ? 1 : 0, c.ignoreReason, c.takeoff ? 1 : 0, CLASSIFIER_VERSION, r.id)
    }
  })()
  return rows.length
}

interface IngestState {
  ino: number
  offset: number
}

function loadState(db: Database.Database): IngestState | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(STATE_KEY) as { value: string } | undefined
  if (!row) return null
  try {
    const s = JSON.parse(row.value)
    return typeof s.ino === 'number' && typeof s.offset === 'number' ? s : null
  } catch {
    return null
  }
}

const saveState = (db: Database.Database, s: IngestState) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(STATE_KEY, JSON.stringify(s))

/** Один проход: читает новые строки логов (или делает полный бэкфилл, если позиции нет). Идемпотентен. */
export function ingestAlerts(db: Database.Database, logPath = ALERT_LOG): { added: number; backfill: boolean } {
  let added = 0
  const rotated = ROTATED.map((n) => `${logPath}.${n}`).filter((f) => existsSync(f))
  if (!existsSync(logPath)) return { added: 0, backfill: false }
  const cur = statSync(logPath)
  const state = loadState(db)

  const takeFull = (files: string[]) => {
    for (const f of files) added += storeAlerts(db, scanLog(f, 0, true).records)
  }

  let offset = 0
  let backfill = false
  if (!state) {
    backfill = true
    takeFull(rotated)
  } else if (state.ino === cur.ino) {
    offset = cur.size < state.offset ? 0 : state.offset
  } else {
    // Ротация: ищем файл с прежним inode (rename сохраняет его), дочитываем хвост и все более новые ротированные файлы
    const idx = rotated.findIndex((f) => statSync(f).ino === state.ino)
    if (idx >= 0) {
      added += storeAlerts(db, scanLog(rotated[idx], state.offset, true).records)
      takeFull(rotated.slice(idx + 1))
    } else {
      backfill = true
      takeFull(rotated)
    }
  }
  const r = scanLog(logPath, offset, false)
  added += storeAlerts(db, r.records)
  saveState(db, { ino: cur.ino, offset: r.nextOffset })
  reclassifyOld(db)
  return { added, backfill }
}

let running = false
export function startAlertIngest(log: FastifyBaseLogger, db: Database.Database) {
  const tick = () => {
    if (running) return
    running = true
    try {
      const r = ingestAlerts(db)
      if (r.added || r.backfill) log.info({ added: r.added, backfill: r.backfill }, 'статистика обстрелов: загрузка из логов')
    } catch (e) {
      log.warn({ err: (e as Error).message }, 'статистика обстрелов: ошибка загрузки')
    } finally {
      running = false
    }
  }
  setTimeout(tick, 5_000) // бэкфилл не мешает старту
  setInterval(tick, 10 * 60_000)
}

// ---------- выборки для карточки Air Alert ----------
const DAY_MS = 86_400_000
const dayKey = (ts: number) => new Date(ts).toLocaleDateString('sv-SE')
const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY_MS)

export interface AlertStats {
  version: number
  bucket: 'day' | 'week'
  /** Столбики от старых к новым (как alertsSeries). all — все сообщения; missile — ракетные (is_missile); rest = all − missile;
   *  drone / aviation / other — по категориям (сообщение может попасть в несколько) */
  series: { day: string; all: number; missile: number; rest: number; drone: number; aviation: number; other: number }[]
  totals: { all: number; missile: number; drone: number; aviation: number; other: number; missileDays: number }
  /** первая запись в таблице (история копится с момента, когда логи начали разбираться) */
  coverageFrom: number
  covered: boolean
  lastMissile: { ts: number; text: string; categories: string } | null
  /** последний вылет носителей (Ту-95/160/22, МіГ-31К) — отдельно от ракет */
  lastStrategic: { ts: number; text: string } | null
  /** Паузы между ракетными днями за ВСЮ историю, в календарных днях (1 = ракеты два дня подряд) */
  pauses: { count: number; min: number | null; median: number | null; max: number | null; last: { from: string; to: string; days: number }[] }
}

export function alertStats(db: Database.Database, days: number, now = Date.now()): AlertStats | null {
  const head = db.prepare('SELECT COUNT(*) n, MIN(ts) first FROM alert_events WHERE ignored = 0').get() as { n: number; first: number | null }
  if (!head.n || head.first == null) return null

  const since = now - days * DAY_MS
  const bucket: 'day' | 'week' = days > 90 ? 'week' : 'day'
  const size = bucket === 'week' ? 7 : 1
  const n = Math.ceil(days / size)
  const series = Array.from({ length: n }, (_, i) => ({
    day: dayKey(now - (n - i) * size * DAY_MS + DAY_MS), all: 0, missile: 0, rest: 0, drone: 0, aviation: 0, other: 0,
  }))
  const totals = { all: 0, missile: 0, drone: 0, aviation: 0, other: 0, missileDays: 0 }
  const rows = db.prepare('SELECT ts, categories, is_missile FROM alert_events WHERE ignored = 0 AND ts >= ? AND ts <= ?').all(since, now) as { ts: number; categories: string; is_missile: number }[]
  const missileDaysInPeriod = new Set<string>()
  for (const r of rows) {
    const idx = Math.floor((now - r.ts) / (size * DAY_MS))
    if (idx >= n) continue
    const s = series[n - 1 - idx]
    const cats = r.categories.split(',')
    s.all++
    totals.all++
    if (r.is_missile) {
      s.missile++
      totals.missile++
      missileDaysInPeriod.add(dayKey(r.ts))
    } else s.rest++
    if (cats.includes('drone')) (s.drone++, totals.drone++)
    if (cats.includes('aviation')) (s.aviation++, totals.aviation++)
    if (cats.includes('other')) (s.other++, totals.other++)
  }
  totals.missileDays = missileDaysInPeriod.size

  const lastMissile = (db.prepare('SELECT ts, text, categories FROM alert_events WHERE ignored = 0 AND is_missile = 1 ORDER BY ts DESC LIMIT 1').get() as AlertStats['lastMissile']) ?? null
  const lastStrategic = (db.prepare('SELECT ts, text FROM alert_events WHERE ignored = 0 AND takeoff = 1 ORDER BY ts DESC LIMIT 1').get() as AlertStats['lastStrategic']) ?? null

  const missileDays = (db.prepare('SELECT DISTINCT day FROM alert_events WHERE ignored = 0 AND is_missile = 1 ORDER BY day').all() as { day: string }[]).map((r) => r.day)
  const gaps = missileDays.slice(1).map((d, i) => ({ from: missileDays[i], to: d, days: dayNum(d) - dayNum(missileDays[i]) }))
  const sorted = gaps.map((g) => g.days).sort((a, b) => a - b)
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null

  return {
    version: CLASSIFIER_VERSION,
    bucket,
    series,
    totals,
    coverageFrom: head.first,
    covered: head.first <= since + DAY_MS,
    lastMissile,
    lastStrategic,
    pauses: { count: gaps.length, min: sorted[0] ?? null, median, max: sorted.at(-1) ?? null, last: gaps.slice(-10) },
  }
}
