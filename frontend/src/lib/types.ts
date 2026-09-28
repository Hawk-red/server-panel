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

export type Problem = {
  level: 'error' | 'warning'
  text: string
  kind: 'unit' | 'disk' | 'smart' | 'temp' | 'devices' | 'source' | 'internet' | 'backup' | 'deadline'
  ref: string
  link: string
}

export type Diagnostics = { kind: string; ref: string; status: string; logSource: string | null; lines: string[]; copy: string }

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

// ---------- Этап 3 ----------
export type Part<T> = { data: T; error: null } | { data: null; error: string }

export type Container = {
  id: string
  name: string
  image: string
  state: string
  status: string
  startedAt: number | null
  ports: { host: number | null; container: number; proto: string; ip: string | null }[]
  networkMode: string | null
  restartPolicy: string | null
  composeProject: string | null
  composeDir: string | null
  version: string | null
  cpuPercent: number | null
  memUsage: number | null
  memLimit: number | null
  protected: boolean
  warning?: string
  web: { port: number; path?: string } | null
}

export type DockerData = {
  version: Part<{ engine: string; api: string; compose: string | null }>
  containers: Part<Container[]>
  images: Part<{ id: string; tags: string[]; size: number; created: number; used: boolean }[]>
}

export type MediaData = {
  jellyfin: {
    container: Part<Container>
    info: Part<{ version: string; name: string }>
    sessions: Part<
      {
        user: string
        client: string
        device: string
        lastActivity: number
        playing: { title: string; type: string; paused: boolean; progress: number | null } | null
      }[]
    >
  }
  minimserver: { container: Part<Container> }
  bubbleupnpserver: { container: Part<Container> }
  marantz: Part<{ host: string; webPort: number; online: boolean; power: string | null; source: string | null }>
}

export type TorrentSummary = {
  version: string
  connection: string
  speed: { dl: number; ul: number }
  session: { dl: number; ul: number }
  alltime: { dl: number; ul: number; ratio: number }
  counts: { total: number; downloading: number; seeding: number; stopped: number; errored: number }
  active: {
    hash: string
    name: string
    progress: number
    dlspeed: number
    upspeed: number
    seeds: number
    seedsTotal: number
    peers: number
    peersTotal: number
    eta: number | null
    size: number
    state: string
  }[]
}

export type SpaceGuard = {
  scriptReadable: boolean
  thresholdGb: number | null
  resumeGb: number | null
  watchedPath: string | null
  watchedFree: number | null
  downloadsPath: string
  downloadsFree: number | null
  downloadsTotal: number | null
  mismatch: boolean
  lastPause: { at: number | null; text: string } | null
}

export type TorrentsData = { container: Part<Container>; summary: Part<TorrentSummary>; guard: Part<SpaceGuard> }

export type AdguardData = {
  container: Part<Container>
  status: Part<{ version: string; running: boolean; protection_enabled: boolean; protection_disabled_duration?: number; dns_port: number; http_port: number }>
  stats: Part<{
    timeUnits: 'hours' | 'days'
    queries: number
    blocked: number
    blockedPercent: number
    avgMs: number
    topClients: { name: string; count: number }[]
    topBlocked: { name: string; count: number }[]
  }>
  interval: Part<number | null>
  querylogSize: Part<number | null>
}

// ---------- Этап 4 ----------
export type UnitInfo = { unit: string; active: string; sub: string; since: number | null }

export type SitesData = {
  units: Part<UnitInfo[]>
  versions: Part<Record<'nginx' | 'php' | 'mariadb' | 'mongod' | 'wordpress', string | null>>
  sync: Part<{
    started: number | null
    finished: number | null
    durationSec: number | null
    status: 'ok' | 'warnings' | 'running-or-failed'
    errors: string[]
    tail: string[]
  } | null>
  backup: Part<{ count: number; dates: string[]; latest: string | null; latestMtime: number | null }>
  exposure: Part<{ restricted: boolean; allows: string[] }>
  pulsdev: {
    version: Part<{ name: string; version: string }>
    health: Part<{ ok: boolean; ms: number; body: string }>
    healthTls: Part<{ status: number; ms: number }>
    cert: Part<{ validTo: number; daysLeft: number; issuer: string | null; subject: string | null }>
  }
}

export type TelegramData = {
  units: Part<UnitInfo[]>
  alertMonitor: Part<{
    bot: string | null
    channel: string | null
    subscribers: number
    delivery: { avgSec: number; maxSec: number; messages: number } | null
    alertsToday: number
    lastAlert: { ts: number | null; text: string } | null
    lastChannelMessage: number | null
    problems: { ts: number | null; text: string }[]
  }>
  leadBot: Part<{
    pollErrors24h: number
    lastPollError: { ts: number; text: string } | null
    leadEvents24h: number
    recent: { ts: number; text: string }[]
  }>
}

// ---------- Этап 5 ----------
export type SshKey = {
  user: string
  line: number
  type: string
  fingerprint: string
  comment: string | null
  options: string | null
  restricted: boolean
  disabled: boolean
  lastUsed: { ts: number; ip: string } | null
}
export type LoginEvent = { ts: number; ok: boolean; user: string; ip: string; method: string; fp: string | null; text: string }
export type LoginSession = {
  id: string
  user: string
  remote: boolean
  from: string | null
  service: string | null
  tty: string | null
  type: string
  since: number | null
  killable: boolean
}
export type AccessData = {
  ssh: Part<{ socket: string; service: string; running: boolean; port: number; passwordAuth: string; kbdInteractive: string; pubkeyAuth: string; permitRootLogin: string }>
  keys: Part<SshKey[]>
  sessions: Part<LoginSession[]>
  history: Part<LoginEvent[]>
  f2b: Part<{ jails: { name: string; currentlyFailed: number; totalFailed: number; currentlyBanned: number; totalBanned: number; banned: string[] }[]; ignoreip: string[] }>
  ufw: Part<{ num: number; to: string; from: string; comment: string | null; panel: boolean }[]>
  remote: Part<{ rdp: { service: string; listening: boolean; port: number }; vnc: { listening: boolean; port: number } }>
  wg: Part<{
    status: string
    iface: { publicKey: string; port: number } | null
    peers: { publicKey: string; name: string | null; endpoint: string | null; allowedIps: string; handshake: number | null; rx: number; tx: number }[]
  }>
}

// ---------- Этап 6 ----------
export type DeviceType = 'router' | 'server' | 'desktop' | 'laptop' | 'phone' | 'tablet' | 'tv' | 'receiver' | 'ir' | 'iot' | 'printer' | 'unknown'
export type Device = {
  mac: string
  ip: string
  vendor: string | null
  randomMac: boolean
  hostname: string | null
  name: string | null
  type: DeviceType
  known: boolean
  online: boolean
  firstSeen: number
  lastSeen: number
  portsScannedAt: number | null
  sortOrder: number | null
  location: string | null
  note: string | null
  ports: { port: number; proto: string; service: string | null; web: boolean }[]
}
export type NetworkData = {
  devices: Device[]
  summary: { total: number; online: number; unknown: number }
  status: {
    lastDiscovery: number | null
    lastDiscoveryError: string | null
    arpScan: boolean | null
    scanning: { mac: string; ip: string; started: number } | null
    nightly: { lastRun: string | null; running: boolean }
  }
}

// ---------- Этап 9: Telegram-боты из реестра ----------
export type FileInfo = { path: string; mtime: number | null; size: number | null; access: boolean; missing?: boolean } | null
export type BotInfo = {
  id: string
  title: string
  description: string | null
  kind: 'alert-monitor' | 'lead-api' | 'generic'
  unit: string
  logSource: string | null
  links: { title: string; url: string }[]
  paths: { dir: FileInfo; entry: FileInfo; config: FileInfo; log: FileInfo }
  service: Part<{ active: string; sub: string; since: number | null; restarts: number; pid: number | null; memory: number | null }>
  runtime: Part<string | null>
  telegram: Part<{ username: string | null; name?: string; error: string | null }>
  problems: Part<{ ts: number | null; text: string }[]>
  analytics: Part<unknown>
}
export type AlertAnalytics = {
  channel: string | null
  subscribers: number
  keywords: { key: string; title: string; words: string[] }[]
  alertsPerDay: { day: string; count: number }[]
  lastAlerts: { ts: number; reason: string; text: string }[]
  delivery: { avgSec: number; maxSec: number; messages: number } | null
}
export type LeadAnalytics = {
  loggingEnabled: boolean
  leadsPerDay: { day: string; count: number }[]
  lastLeads: { ts: number; ok: boolean; contact: string | null; task: boolean | null }[]
  rejected30d: number
  greeted30d: number
  pollErrors24h: number
}

// ---------- Этап 9: журнал (действия + системные события) ----------
export type FeedRow = {
  type: 'user' | 'system'
  id: number
  ts: number
  ip: string | null
  user: string | null
  kind: string
  target: string | null
  details: unknown
  level: 'ok' | 'error' | 'denied' | 'info' | 'warning'
  text: string | null
}
export type AuditSummary = {
  actions: { day: number; week: number }
  events: { day: number; week: number }
  problems: { day: number; week: number }
  perDay: { day: string; type: 'user' | 'system'; problems: number; n: number }[]
}
