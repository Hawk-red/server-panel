// AdGuard Home API (Basic auth)
import { config } from '../config.js'
import { sudo } from '../exec.js'
import { httpJson, http } from '../http.js'
import { NotConfigured } from './qbittorrent.js'

export const QUERYLOG_PATH = '/var/lib/docker/volumes/adguardhome_work/_data/data/querylog.json'

function auth() {
  if (!config.adguard.user || !config.adguard.password) throw new NotConfigured('не заданы ADGUARD_USER/ADGUARD_PASSWORD')
  return { Authorization: `Basic ${Buffer.from(`${config.adguard.user}:${config.adguard.password}`).toString('base64')}` }
}

const get = <T>(path: string) => httpJson<T>(`${config.adguard.url}/control${path}`, { headers: auth() })

export type AdguardStatus = {
  version: string
  running: boolean
  protection_enabled: boolean
  protection_disabled_duration?: number
  dns_port: number
  http_port: number
}

type Stats = {
  time_units: 'hours' | 'days'
  num_dns_queries: number
  num_blocked_filtering: number
  avg_processing_time: number
  dns_queries: number[]
  blocked_filtering: number[]
  top_clients: Record<string, number>[]
  top_blocked_domains: Record<string, number>[]
}

const flat = (arr: Record<string, number>[]) => arr.slice(0, 10).map((o) => ({ name: Object.keys(o)[0], count: Object.values(o)[0] }))

export async function status() {
  return get<AdguardStatus>('/status')
}

export async function stats() {
  const s = await get<Stats>('/stats')
  return {
    timeUnits: s.time_units,
    queries: s.num_dns_queries,
    blocked: s.num_blocked_filtering,
    blockedPercent: s.num_dns_queries > 0 ? Math.round((s.num_blocked_filtering / s.num_dns_queries) * 1000) / 10 : 0,
    avgMs: Math.round(s.avg_processing_time * 10000) / 10,
    topClients: flat(s.top_clients),
    topBlocked: flat(s.top_blocked_domains),
    series: { queries: s.dns_queries, blocked: s.blocked_filtering },
  }
}

export async function statsInterval(): Promise<number | null> {
  const s = await get<{ interval?: number }>('/stats/config').catch(() => null)
  return s?.interval ?? null // мс
}

// duration: мс; 0/undefined — до ручного включения
export async function setProtection(enabled: boolean, durationMs?: number) {
  await http(`${config.adguard.url}/control/protection`, {
    method: 'POST',
    headers: { ...auth(), 'content-type': 'application/json' },
    body: JSON.stringify(enabled ? { enabled: true } : { enabled: false, ...(durationMs ? { duration: durationMs } : {}) }),
  })
}

// Файл журнала запросов лежит в volume Docker (root) — размер через sudo stat (whitelist)
export async function querylogSize(): Promise<number | null> {
  try {
    return Number((await sudo(['/usr/bin/stat', '-c', '%s', QUERYLOG_PATH], { timeoutMs: 5000 })).trim())
  } catch {
    return null
  }
}
