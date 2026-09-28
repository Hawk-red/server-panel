// Типы ответов /api/internet, /api/backups, /api/deadlines, /api/quick (этап 10)
export type Part<T> = { data: T; error: null } | { data: null; error: string }

export type InternetStatus = {
  now: { ts: number; main: number | null; second: number | null; online: boolean } | null
  downSince: number | null
  ip: { ip: string; since: number; checkedAt: number } | null
  outages: { from: number; to: number; sec: number }[]
  day: InternetStats
  week: InternetStats
  targets: { main: string; second: string }
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
}
