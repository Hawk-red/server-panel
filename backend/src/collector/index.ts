// Коллектор метрик. Главное правило: сбой любого источника не должен
// ронять API — каждый источник в своём try/catch, результат либо данные, либо null.
import type { FastifyBaseLogger } from 'fastify'
import { listDisks, refreshAllSmart, type DiskInfo } from '../system/disks.js'
import * as src from './sources.js'
import * as adguard from '../services/adguard.js'
import * as qbt from '../services/qbittorrent.js'
import * as scanner from '../network/scanner.js'
import { rollupAndPrune, writeHourly, writeSample } from './store.js'

export const SAMPLE_INTERVAL = 30_000

export type SourceName =
  | 'cpu'
  | 'load'
  | 'memory'
  | 'temperature'
  | 'fan'
  | 'network'
  | 'uptime'
  | 'disks'
  | 'smart'
  | 'qbittorrent'
  | 'adguard'
  | 'network'

export type Snapshot = {
  ts: number
  cpu: { total: number; cores: number[] } | null
  load: { l1: number; l5: number; l15: number } | null
  memory: Awaited<ReturnType<typeof src.readMemory>> | null
  temperature: { cpu: number; cores: number[] } | null
  fan: { rpm: number; min: number | null; max: number | null } | null
  network: Record<string, { rxBps: number; txBps: number; rxTotal: number; txTotal: number }> | null
  uptimeSec: number | null
  disks: DiskInfo[] | null
  // Ошибки источников: что сломалось и с какого момента
  errors: Partial<Record<SourceName, { message: string; since: number }>>
}

let log: FastifyBaseLogger | undefined
let prevCpu: src.CpuTimes | null = null
let prevNet: { ts: number; counters: src.NetCounters } | null = null
let latest: Snapshot | null = null
const errors: Snapshot['errors'] = {}
const timers: NodeJS.Timeout[] = []

async function safe<T>(name: SourceName, fn: () => Promise<T>): Promise<T | null> {
  try {
    const value = await fn()
    if (errors[name]) {
      log?.info({ source: name }, 'источник метрик снова доступен')
      delete errors[name]
    }
    return value
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (!errors[name] || errors[name]!.message !== message) {
      log?.warn({ source: name, err: message }, 'источник метрик недоступен')
      errors[name] = { message, since: errors[name]?.since ?? Date.now() }
    }
    return null
  }
}

async function sample() {
  const ts = Date.now()
  const cpu = await safe('cpu', async () => {
    const cur = await src.readCpuTimes()
    const prev = prevCpu
    prevCpu = cur
    if (!prev) return null
    const [total, ...cores] = src.cpuPercent(prev, cur)
    return { total, cores }
  })
  const load = await safe('load', src.readLoad)
  const memory = await safe('memory', src.readMemory)
  const temperature = await safe('temperature', src.readCpuTemp)
  const fan = await safe('fan', src.readFan)
  const uptimeSec = await safe('uptime', src.readUptime)
  const network = await safe('network', async () => {
    const counters = await src.readNetCounters()
    const prev = prevNet
    prevNet = { ts, counters }
    if (!prev) return null
    const dt = (ts - prev.ts) / 1000
    const out: NonNullable<Snapshot['network']> = {}
    for (const [iface, c] of Object.entries(counters)) {
      const p = prev.counters[iface]
      out[iface] = {
        rxBps: p && dt > 0 ? Math.max(0, (c.rx - p.rx) / dt) : 0,
        txBps: p && dt > 0 ? Math.max(0, (c.tx - p.tx) / dt) : 0,
        rxTotal: c.rx,
        txTotal: c.tx,
      }
    }
    return out
  })
  const disks = await safe('disks', listDisks)
  const torrents = await safe('qbittorrent', qbt.transferSpeed)

  latest = { ts, cpu, load, memory, temperature, fan, network, uptimeSec, disks, errors: { ...errors } }

  // В SQLite пишем только то, что есть; отсутствующие источники — просто пропуск
  const values: Record<string, number> = {}
  if (cpu) {
    values['cpu.total'] = cpu.total
    cpu.cores.forEach((v, i) => (values[`cpu.core${i}`] = v))
  }
  if (load) values['load.1'] = load.l1
  if (memory) {
    values['mem.used_pct'] = (memory.used / memory.total) * 100
    if (memory.swapTotal > 0) values['swap.used_pct'] = (memory.swapUsed / memory.swapTotal) * 100
  }
  if (temperature) values['temp.cpu'] = temperature.cpu
  if (fan) values['fan.rpm'] = fan.rpm
  if (network) {
    for (const [iface, n] of Object.entries(network)) {
      values[`net.${iface}.rx`] = n.rxBps
      values[`net.${iface}.tx`] = n.txBps
    }
  }
  for (const d of disks ?? []) {
    if (d.mount && d.percent !== null) values[`disk.${d.mount}.used_pct`] = d.percent
    if (d.smart?.temperature != null) values[`temp.disk.${d.disk}`] = d.smart.temperature
  }
  if (torrents) {
    values['torrent.dl'] = torrents.dl
    values['torrent.ul'] = torrents.ul
  }
  try {
    writeSample(ts, values)
  } catch (e) {
    log?.error({ err: (e as Error).message }, 'не удалось записать метрики')
  }
}

// AdGuard отдаёт массив за свой интервал; копим почасовые значения у себя,
// чтобы графики за неделю/месяц не зависели от настроек статистики AdGuard
async function sampleAdguard() {
  const s = await adguard.stats()
  if (s.timeUnits !== 'hours') throw new Error('статистика AdGuard в днях — почасовая история не пишется')
  const hour = Math.floor(Date.now() / 3_600_000) * 3_600_000
  const n = s.series.queries.length
  const at = (i: number) => hour - (n - 1 - i) * 3_600_000
  writeHourly('adguard.queries', s.series.queries.map((v, i) => [at(i), v] as [number, number]))
  writeHourly('adguard.blocked', s.series.blocked.map((v, i) => [at(i), v] as [number, number]))
}

function every(ms: number, fn: () => unknown) {
  const run = () => {
    Promise.resolve()
      .then(fn)
      .catch((e) => log?.error({ err: (e as Error).message }, 'ошибка фоновой задачи коллектора'))
  }
  run()
  timers.push(setInterval(run, ms))
}

export function startCollector(logger: FastifyBaseLogger) {
  log = logger
  every(SAMPLE_INTERVAL, sample)
  every(5 * 60_000, () => rollupAndPrune())
  every(10 * 60_000, () => safe('smart', refreshAllSmart))
  every(5 * 60_000, () => safe('adguard', sampleAdguard))
  // Сеть: быстрое обнаружение раз в 5 мин, ночное сканирование портов в 03:30
  scanner.startScanner(logger)
  every(5 * 60_000, () => safe('network', scanner.discover))
  every(60_000, () => scanner.nightlyIfDue())
}

export function stopCollector() {
  timers.forEach(clearInterval)
}

export function getSnapshot(): Snapshot | null {
  return latest
}
