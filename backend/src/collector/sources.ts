// Источники метрик. Каждая функция может бросить исключение —
// коллектор ловит его и считает источник «нет данных».
import { readFile, readdir, statfs } from 'node:fs/promises'
import path from 'node:path'

export type CpuTimes = { idle: number; total: number }[] // [0] — суммарно, дальше по ядрам

export async function readCpuTimes(): Promise<CpuTimes> {
  const text = await readFile('/proc/stat', 'utf8')
  const out: CpuTimes = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('cpu')) continue
    const nums = line.trim().split(/\s+/).slice(1).map(Number)
    const idle = nums[3] + (nums[4] ?? 0) // idle + iowait
    const total = nums.slice(0, 8).reduce((a, b) => a + b, 0)
    out.push({ idle, total })
  }
  if (!out.length) throw new Error('/proc/stat без строк cpu')
  return out
}

export function cpuPercent(prev: CpuTimes, cur: CpuTimes): number[] {
  return cur.map((c, i) => {
    const p = prev[i]
    if (!p) return 0
    const dt = c.total - p.total
    return dt > 0 ? Math.max(0, Math.min(100, (1 - (c.idle - p.idle) / dt) * 100)) : 0
  })
}

export async function readLoad() {
  const [l1, l5, l15] = (await readFile('/proc/loadavg', 'utf8')).split(' ').map(Number)
  return { l1, l5, l15 }
}

export async function readUptime() {
  return Math.round(Number((await readFile('/proc/uptime', 'utf8')).split(' ')[0]))
}

export async function readMemory() {
  const kv: Record<string, number> = {}
  for (const line of (await readFile('/proc/meminfo', 'utf8')).split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)/)
    if (m) kv[m[1]] = Number(m[2]) * 1024
  }
  if (!kv.MemTotal) throw new Error('/proc/meminfo без MemTotal')
  const used = kv.MemTotal - (kv.MemAvailable ?? kv.MemFree)
  const swapUsed = (kv.SwapTotal ?? 0) - (kv.SwapFree ?? 0)
  return {
    total: kv.MemTotal,
    used,
    available: kv.MemAvailable ?? kv.MemFree,
    cache: (kv.Cached ?? 0) + (kv.Buffers ?? 0),
    swapTotal: kv.SwapTotal ?? 0,
    swapUsed,
  }
}

async function findHwmon(name: string): Promise<string | null> {
  const base = '/sys/class/hwmon'
  for (const d of await readdir(base)) {
    const n = await readFile(path.join(base, d, 'name'), 'utf8').catch(() => '')
    if (n.trim() === name) return path.join(base, d)
  }
  return null
}

// coretemp: «Package id 0» + ядра, °C
export async function readCpuTemp() {
  const dir = await findHwmon('coretemp')
  if (!dir) throw new Error('датчик coretemp не найден')
  let pkg: number | null = null
  const cores: number[] = []
  for (const f of await readdir(dir)) {
    const m = f.match(/^temp(\d+)_label$/)
    if (!m) continue
    const label = (await readFile(path.join(dir, f), 'utf8')).trim()
    const value = Number(await readFile(path.join(dir, `temp${m[1]}_input`), 'utf8')) / 1000
    if (label.startsWith('Package')) pkg = value
    else if (label.startsWith('Core')) cores.push(value)
  }
  if (pkg === null && !cores.length) throw new Error('coretemp без значений')
  return { cpu: pkg ?? Math.max(...cores), cores }
}

// Вентилятор Mac (applesmc, им управляет mbpfan)
export async function readFan() {
  const base = '/sys/devices/platform/applesmc.768'
  const num = async (f: string) => Number((await readFile(path.join(base, f), 'utf8')).trim())
  return { rpm: await num('fan1_input'), min: await num('fan1_min').catch(() => null), max: await num('fan1_max').catch(() => null) }
}

export type NetCounters = Record<string, { rx: number; tx: number }>

const NET_IFACES = /^(enp|eth|wlp|wlan|wg|docker0$)/

export async function readNetCounters(): Promise<NetCounters> {
  const out: NetCounters = {}
  for (const line of (await readFile('/proc/net/dev', 'utf8')).split('\n').slice(2)) {
    const [name, rest] = line.split(':')
    if (!rest) continue
    const iface = name.trim()
    if (!NET_IFACES.test(iface)) continue
    const f = rest.trim().split(/\s+/).map(Number)
    out[iface] = { rx: f[0], tx: f[8] }
  }
  return out
}

export type DiskIoCounters = Record<string, { readSectors: number; writeSectors: number }>

// Только целые диски (sda, nvme0n1, vda, mmcblk0) — разделы (sda1, nvme0n1p1) пропускаем
const DISK_DEV_RE = /^(sd[a-z]+|nvme\d+n\d+|vd[a-z]+|mmcblk\d+)$/

export async function readDiskIoCounters(): Promise<DiskIoCounters> {
  const out: DiskIoCounters = {}
  for (const line of (await readFile('/proc/diskstats', 'utf8')).split('\n')) {
    const f = line.trim().split(/\s+/)
    if (f.length < 10 || !DISK_DEV_RE.test(f[2])) continue
    out[f[2]] = { readSectors: Number(f[5]), writeSectors: Number(f[9]) }
  }
  return out
}

export async function readFsUsage(mount: string) {
  const s = await statfs(mount)
  const total = s.blocks * s.bsize
  const free = s.bavail * s.bsize
  const used = total - s.bfree * s.bsize
  return { total, used, free, percent: total > 0 ? Math.round((used / (used + free)) * 1000) / 10 : 0 }
}
