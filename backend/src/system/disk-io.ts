// Фоновый сборщик live-скорости чтения/записи по дискам. Работает ПОСТОЯННО, пока жив процесс сервера,
// независимо от того, открыт ли раздел «Диски» в браузере — так при открытии раздела история уже накоплена
// и график не пустой. Отдельно от основного коллектора (тот сэмплит раз в 30 с — слишком редко для живого
// графика), в БД ничего не пишем, храним только короткое окно в памяти (кольцевой буфер).
//
// Это ЕДИНСТВЕННЫЙ читатель /proc/diskstats: если считать дельту ещё и по HTTP-запросу параллельно (как было
// раньше), общий «предыдущий снимок» собьётся гонкой между фоновым тиком и запросом с фронта. Поэтому и
// «живой» эндпоинт (/api/system/disks/io), и история (/api/system/disks/io-history) просто читают из одного
// и того же буфера, который наполняет только этот таймер. Арифметика — в disk-rate.ts (покрыта тестами).
import type { FastifyBaseLogger } from 'fastify'
import { readDiskIoCounters, type DiskIoCounters } from '../collector/sources.js'
import { type DiskIoPoint, type RateWindow, diskRate, hadActivity, windowStats } from './disk-rate.js'

export type { DiskIoPoint }

const TICK_MS = 1500
const HISTORY_LEN = 160 // ~4 минуты при тике 1.5 с

let prev: { ts: number; counters: DiskIoCounters } | null = null
const history: Record<string, DiskIoPoint[]> = {}
// Когда последний раз был ввод-вывод (любой: чтение, запись, discard, flush) — для решения «Спит»
const lastActivity: Record<string, number> = {}
let startedAt = 0
let timer: ReturnType<typeof setInterval> | null = null
let log: FastifyBaseLogger | undefined

async function tick() {
  try {
    const counters = await readDiskIoCounters()
    // Метка времени — ПОСЛЕ чтения файла: дельта считается между моментами реального чтения /proc/diskstats,
    // а не между моментами «собрались читать» (иначе задержка чтения искажала бы dt)
    const ts = Date.now()
    const p = prev
    const dt = p ? (ts - p.ts) / 1000 : 0
    for (const [name, c] of Object.entries(counters)) {
      const pc = p?.counters[name]
      const point: DiskIoPoint = { ts, ...diskRate(pc, c, dt) }
      if (hadActivity(pc, c)) lastActivity[name] = ts
      const arr = history[name] ?? (history[name] = [])
      arr.push(point)
      if (arr.length > HISTORY_LEN) arr.splice(0, arr.length - HISTORY_LEN)
    }
    prev = { ts, counters }
  } catch (e) {
    log?.warn({ err: (e as Error).message }, 'не удалось прочитать /proc/diskstats')
  }
}

export function startDiskIoCollector(logger: FastifyBaseLogger) {
  log = logger
  if (timer) return
  startedAt = Date.now()
  void tick()
  timer = setInterval(() => void tick(), TICK_MS)
}

export function stopDiskIoCollector() {
  if (timer) clearInterval(timer)
  timer = null
}

// Весь буфер за последние ~4 минуты, по каждому диску — для первичной отрисовки графика одним запросом
export function getDiskIoHistory(): Record<string, DiskIoPoint[]> {
  return history
}

export type DiskIoLatest = { readBps: number; writeBps: number } & RateWindow

// Последняя точка буфера (как раньше) + среднее за 15 с и пик за 2 мин — для плашек «Чтение»/«Запись»
export function getDiskIoLatest(): { ts: number; disks: Record<string, DiskIoLatest> } {
  const now = Date.now()
  const disks: Record<string, DiskIoLatest> = {}
  for (const [name, arr] of Object.entries(history)) {
    const last = arr[arr.length - 1]
    if (last) disks[name] = { readBps: last.readBps, writeBps: last.writeBps, ...windowStats(arr, now) }
  }
  return { ts: now, disks }
}

// Сколько мс у диска нет ввода-вывода. Если активности с запуска сборщика не было — это нижняя оценка
// (с момента запуска); null — сборщик не работает или диска нет в /proc/diskstats.
export function getDiskIdleMs(name: string, now = Date.now()): number | null {
  if (!startedAt || !(name in history)) return null
  return now - Math.max(lastActivity[name] ?? 0, startedAt)
}
