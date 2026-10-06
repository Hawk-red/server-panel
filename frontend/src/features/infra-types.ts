// Типы ответов /api/internet, /api/backups, /api/deadlines, /api/quick (этап 10)
export type Part<T> = { data: T; error: null } | { data: null; error: string }

export type InternetStatus = {
  now: { ts: number; main: number | null; second: number | null; online: boolean; extra?: { router: number | null; prod: number | null; adguard: number | null } } | null
  downSince: number | null
  ip: { ip: string; since: number; checkedAt: number } | null
  outages: { from: number; to: number; sec: number }[]
  day: InternetStats
  week: InternetStats
  targets: { main: string; second: string; router: string; prod: string; adguard: string }
  targetDay: Record<'main' | 'second' | 'router' | 'prod' | 'adguard', { avgMs: number | null; maxMs: number | null }>
}
export type InternetStats = { avgMs: number | null; maxMs: number | null; lossPct: number | null; samples: number }

export type BackupItem = {
  id: string
  title: string
  description: string
  path: string
  type: 'scheduled' | 'oneoff'
  maxAgeH: number | null
  status: 'ok' | 'stale' | 'missing' | 'nodata'
  note: string | null
  latest: { name: string; mtime: number } | null
  ageSec: number | null
  count: number | null
  sizeBytes: number | null
  totalBytes: number | null
  entries?: { name: string; mtime: number | null; sizeBytes: number | null; note?: string }[]
  extra?: {
    sync?: { started: number | null; finished: number | null; durationSec: number | null; status: 'ok' | 'warnings' | 'running-or-failed'; errors: number } | null
    freeBytes?: number | null
    lastSnapshot?: string | null
    snapshotsExtraBytes?: number | null
    sizesPending?: boolean
    sizesError?: string | null
  }
}

export type Deadline = {
  id: string
  title: string
  kind: 'cert' | 'domain' | 'token' | 'other'
  source: 'auto' | 'manual'
  expires: number | null
  daysLeft: number | null
  note: string | null
  error: string | null
}
export type DeadlineConfig = { domains: string[]; manual: { id: string; title: string; kind: 'domain' | 'token' | 'other'; date: string; note?: string }[] }

export type QuickState = {
  container: Part<{ state: string }>
  torrents: Part<{ total: number; stopped: number; running: number; allStopped: boolean }>
  protection: Part<{ enabled: boolean; disabledLeftSec: number | null }>
  alertBot: Part<{ active: string; sub: string; since: number | null }>
}

export type BarStatus = 'up' | 'partial' | 'down' | 'unknown'
export type UptimeBar = { ts: number; status: BarStatus; downPct: number }
export type MonitorBars = { id: string; title: string; group: string; day: UptimeBar[]; week: UptimeBar[]; upDay: number | null; upWeek: number | null }
export type UptimeResponse = { generatedAt: number; monitors: MonitorBars[] }

export type ExchangeState = {
  installed: boolean
  container: { state: string; status: string | null } | null
  health: { ok: boolean; ms: number } | null
  urls: { external: string; home: string; admin: string }
  /** где лежат данные: hdd1tb, missing (диск не смонтирован), ssd, other */
  storage: { path: string; target: string | null; place: 'hdd1tb' | 'missing' | 'ssd' | 'other'; note: string }
  disk: { fs: { total: number; used: number; free: number; percent: number } | null; exchangeBytes: number | null; uploadsBytes: number | null } | null
  recent: { ts: number; user: string; ip: string; name: string; size: number }[]
  owner: string
}

export type SpeedResult = {
  ts: number
  trigger: 'manual' | 'schedule'
  downMbps: number | null
  upMbps: number | null
  latencyMs: number | null
  jitterMs: number | null
  colo: string | null
  bytes: number
  durationSec: number
  error: string | null
}
export type SpeedtestState = {
  running: { startedAt: number; phase: string } | null
  results: SpeedResult[]
  schedule: { enabled: boolean; mode: 'daily' | 'hourly' | 'every3h'; time: string; lastDay: string | null; lastSlot: string | null; hourlyMinute: number }
  backoffUntil: number | null
  provider: { name: string; anycast: boolean }
}
