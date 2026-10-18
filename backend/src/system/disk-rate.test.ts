import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AVG_WINDOW_MS, IDLE_THRESHOLD_BPS, type DiskIoPoint, diskRate, hadActivity, windowStats } from './disk-rate.js'

const c = (r: number, w: number, ops = 0) => ({ readSectors: r, writeSectors: w, ops })

describe('diskRate', () => {
  it('дельта секторов × 512 / секунды, независимо от физического сектора', () => {
    assert.deepEqual(diskRate(c(0, 0), c(2000, 8000), 2), { readBps: 512_000, writeBps: 2_048_000 })
  })
  it('первый снимок, нулевой/отрицательный dt и сброс счётчика дают 0, а не NaN/минус', () => {
    assert.deepEqual(diskRate(undefined, c(5, 5), 1.5), { readBps: 0, writeBps: 0 })
    assert.deepEqual(diskRate(c(0, 0), c(5, 5), 0), { readBps: 0, writeBps: 0 })
    assert.deepEqual(diskRate(c(100, 100), c(10, 10), 1), { readBps: 0, writeBps: 0 })
  })
})

describe('hadActivity', () => {
  it('flush/discard без секторов тоже активность; без изменений — нет', () => {
    assert.equal(hadActivity(c(1, 1, 5), c(1, 1, 6)), true)
    assert.equal(hadActivity(c(1, 1, 5), c(1, 1, 5)), false)
    assert.equal(hadActivity(undefined, c(1, 1, 5)), false)
  })
})

describe('windowStats', () => {
  const NOW = 1_000_000
  // 20 точек по 1 с: запись всплесками (каждая 4-я секунда 4 МБ/с), между ними 0 — как writeback
  const pts: DiskIoPoint[] = Array.from({ length: 21 }, (_, i) => ({
    ts: NOW - (20 - i) * 1000,
    readBps: 0,
    writeBps: i % 4 === 1 ? 4_000_000 : 0,
  }))
  it('среднее за окно не падает в ноль между всплесками, пик сохраняется', () => {
    const w = windowStats(pts, NOW)
    assert.ok(w.writeAvgBps > IDLE_THRESHOLD_BPS * 10, `среднее ${w.writeAvgBps}`)
    assert.equal(w.writePeakBps, 4_000_000)
    assert.equal(w.readAvgBps, 0)
    assert.equal(pts[pts.length - 1].writeBps, 0) // последняя точка — «простой», вот почему плашка мигала
  })
  it('в окно усреднения попадают только последние AVG_WINDOW_MS', () => {
    const old: DiskIoPoint[] = [
      { ts: NOW - 60_000, readBps: 0, writeBps: 0 },
      { ts: NOW - 59_000, readBps: 9e6, writeBps: 0 }, // вне окна 15 с, но в окне пика
      { ts: NOW - 1000, readBps: 0, writeBps: 0 },
      { ts: NOW, readBps: 0, writeBps: 0 },
    ]
    const w = windowStats(old, NOW)
    assert.equal(w.readAvgBps, 0)
    assert.equal(w.readPeakBps, 9e6)
    assert.ok(NOW - old[1].ts > AVG_WINDOW_MS)
  })
  it('пик вне окна графика не учитывается; пустая история — нули', () => {
    const w = windowStats([{ ts: NOW - 300_000, readBps: 1, writeBps: 1 }, { ts: NOW - 299_000, readBps: 5e6, writeBps: 5e6 }], NOW)
    assert.deepEqual(w, { readAvgBps: 0, writeAvgBps: 0, readPeakBps: 0, writePeakBps: 0 })
    assert.equal(windowStats([], NOW).writePeakBps, 0)
  })
  it('точки разной длительности взвешиваются временем', () => {
    const w = windowStats(
      [
        { ts: NOW - 10_000, readBps: 0, writeBps: 0 },
        { ts: NOW - 9_000, readBps: 0, writeBps: 1000 }, // 1 с по 1000
        { ts: NOW, readBps: 0, writeBps: 0 }, // 9 с по 0
      ],
      NOW
    )
    assert.equal(Math.round(w.writeAvgBps), 100)
  })
})
