// Фоновый сборщик live-скорости чтения/записи по дискам. Работает ПОСТОЯННО, пока жив процесс сервера,
// независимо от того, открыт ли раздел «Диски» в браузере — так при открытии раздела история уже накоплена
// и график не пустой. Отдельно от основного коллектора (тот сэмплит раз в 30 с — слишком редко для живого
// графика), в БД ничего не пишем, храним только короткое окно в памяти (кольцевой буфер).
//
// Это ЕДИНСТВЕННЫЙ читатель /proc/diskstats: если считать дельту ещё и по HTTP-запросу параллельно (как было
// раньше), общий «предыдущий снимок» собьётся гонкой между фоновым тиком и запросом с фронта. Поэтому и
// «живой» эндпоинт (/api/system/disks/io), и история (/api/system/disks/io-history) просто читают из одного
// и того же буфера, который наполняет только этот таймер.
import type { FastifyBaseLogger } from 'fastify'
import { readDiskIoCounters, type DiskIoCounters } from '../collector/sources.js'

export type DiskIoPoint = { ts: number; readBps: number; writeBps: number }

const TICK_MS = 1500
const HISTORY_LEN = 160 // ~4 минуты при тике 1.5 с
const SECTOR_SIZE = 512

let prev: { ts: number; counters: DiskIoCounters } | null = null
const history: Record<string, DiskIoPoint[]> = {}
let timer: ReturnType<typeof setInterval> | null = null
let log: FastifyBaseLogger | undefined

async function tick() {
  try {
    const ts = Date.now()
    const counters = await readDiskIoCounters()
    const p = prev
    const dt = p ? (ts - p.ts) / 1000 : 0
    for (const [name, c] of Object.entries(counters)) {
      const pc = p?.counters[name]
      const point: DiskIoPoint = {
        ts,
        readBps: pc && dt > 0 ? Math.max(0, ((c.readSectors - pc.readSectors) * SECTOR_SIZE) / dt) : 0,
        writeBps: pc && dt > 0 ? Math.max(0, ((c.writeSectors - pc.writeSectors) * SECTOR_SIZE) / dt) : 0,
      }
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

// Последняя точка буфера — то же самое, что раньше считалось по запросу, но без гонки за /proc/diskstats
export function getDiskIoLatest(): { ts: number; disks: Record<string, { readBps: number; writeBps: number }> } {
  const disks: Record<string, { readBps: number; writeBps: number }> = {}
  for (const [name, arr] of Object.entries(history)) {
    const last = arr[arr.length - 1]
    if (last) disks[name] = { readBps: last.readBps, writeBps: last.writeBps }
  }
  return { ts: Date.now(), disks }
}
