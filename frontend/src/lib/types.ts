// Типы ответов бэкенда (backend/src/collector, backend/src/system)
export type Smart = {
  status: 'ok' | 'failing' | 'standby' | 'unavailable'
  temperature: number | null
  powerOnHours: number | null
  checkedAt: number
  error?: string
}

export type DiskInfo = {
  device: string
  disk: string
  model: string | null
  label: string | null
  uuid: string | null
  fstype: string | null
  transport: string | null
  mount: string | null
  size: number
  used: number | null
  free: number | null
  percent: number | null
  inFstab: boolean
  state: 'mounted' | 'missing' | 'unmounted'
  smart: Smart | null
}

export type Snapshot = {
  ts: number
  cpu: { total: number; cores: number[] } | null
  load: { l1: number; l5: number; l15: number } | null
  memory: { total: number; used: number; available: number; cache: number; swapTotal: number; swapUsed: number } | null
  temperature: { cpu: number; cores: number[] } | null
  fan: { rpm: number; min: number | null; max: number | null } | null
  network: Record<string, { rxBps: number; txBps: number; rxTotal: number; txTotal: number }> | null
  uptimeSec: number | null
  disks: DiskInfo[] | null
  errors: Partial<Record<string, { message: string; since: number }>>
}

export type Problem = { level: 'error' | 'warning'; text: string }

export type Overview = {
  snapshot: Snapshot | null
  services: { running: number; failed: number; total: number } | null
  containers: { running: number; total: number } | null
  devices: null | { total: number; online: number; unknown: number }
  torrents: null | { active: number }
  problems: Problem[]
}

export type ServiceRow = {
  unit: string
  description: string
  load: string
  active: string
  sub: string
  enabled: string | null
  since: number | null
  mainPid: number | null
  memory: number | null
  background: boolean
  controllable: boolean
  warning?: string
}

export type CronJob = {
  source: string
  user: string
  schedule: string
  human: string
  command: string
  next: number | null
  lastRun: number | null
  lastResult: string | null
  kind: 'cron' | 'timer'
  error?: string
}

export type Autostart = {
  units: { unit: string; type: string; preset: string | null; background: boolean }[]
  containers: { name: string; image: string; restart: string; state: string }[] | null
}

export type LogLevel = 'error' | 'warning' | 'info' | 'debug'
export type LogSource = { id: string; title: string; kind: 'journal' | 'file'; group: string; path?: string; size?: number; readable?: boolean }
export type LogLine = { ts: number | null; level: LogLevel; text: string }

export type Range = 'hour' | 'day' | 'week' | 'month' | 'quarter'
export type MetricsResponse = { range: Range; from: number; to: number; step: number; series: Record<string, [number, number, number][]> }
