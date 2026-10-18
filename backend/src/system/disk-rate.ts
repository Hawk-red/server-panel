// Чистая арифметика скоростей дисков (без чтения /proc и таймеров) — отдельно, чтобы покрыть тестами.
// Скорость = дельта секторов × 512 / дельта времени. Ядро Linux считает сектора в /proc/diskstats ВСЕГДА по 512 Б,
// независимо от физического (4096) и логического размера сектора устройства. Секторы discard (TRIM) и flush
// в read/write не входят — это отдельные счётчики, в скорость не попадают, но считаются активностью диска.

export type RawDiskCounters = {
  readSectors: number
  writeSectors: number
  // число завершённых операций: читаем, чтобы заметить активность без передачи данных (flush/discard)
  ops: number
}

export type DiskIoPoint = { ts: number; readBps: number; writeBps: number }

export const SECTOR_SIZE = 512
// Окно усреднения плашек «Чтение»/«Запись» и порог «Простой»
export const AVG_WINDOW_MS = 15_000
export const IDLE_THRESHOLD_BPS = 4 * 1024
// Окно, за которое считается пик (совпадает с горизонтом графика)
export const PEAK_WINDOW_MS = 120_000

export function diskRate(prev: RawDiskCounters | undefined, cur: RawDiskCounters, dtSec: number): { readBps: number; writeBps: number } {
  if (!prev || !(dtSec > 0)) return { readBps: 0, writeBps: 0 }
  // max(0): счётчик мог сброситься (переподключение диска) — отрицательной скорости не бывает
  return {
    readBps: Math.max(0, ((cur.readSectors - prev.readSectors) * SECTOR_SIZE) / dtSec),
    writeBps: Math.max(0, ((cur.writeSectors - prev.writeSectors) * SECTOR_SIZE) / dtSec),
  }
}

export function hadActivity(prev: RawDiskCounters | undefined, cur: RawDiskCounters): boolean {
  return Boolean(prev) && (cur.ops !== prev!.ops || cur.readSectors !== prev!.readSectors || cur.writeSectors !== prev!.writeSectors)
}

export type RateWindow = {
  readAvgBps: number
  writeAvgBps: number
  readPeakBps: number
  writePeakBps: number
}

// Среднее за последние AVG_WINDOW_MS (точки разного шага взвешиваются длительностью — тик может «плыть»)
// и пик по точкам за PEAK_WINDOW_MS. Точка ts — конец интервала; её длительность = ts − ts предыдущей.
export function windowStats(points: DiskIoPoint[], now: number, avgMs = AVG_WINDOW_MS, peakMs = PEAK_WINDOW_MS): RateWindow {
  let rSum = 0
  let wSum = 0
  let span = 0
  let rPeak = 0
  let wPeak = 0
  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    const dur = (p.ts - points[i - 1].ts) / 1000
    if (dur <= 0) continue
    if (now - p.ts <= avgMs) {
      rSum += p.readBps * dur
      wSum += p.writeBps * dur
      span += dur
    }
    if (now - p.ts <= peakMs) {
      rPeak = Math.max(rPeak, p.readBps)
      wPeak = Math.max(wPeak, p.writeBps)
    }
  }
  return {
    readAvgBps: span > 0 ? rSum / span : 0,
    writeAvgBps: span > 0 ? wSum / span : 0,
    readPeakBps: rPeak,
    writePeakBps: wPeak,
  }
}
