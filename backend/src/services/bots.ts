// Telegram-боты из реестра backend/bots.json: общая информация + аналитика по типу бота.
// Токены читаются только на сервере (для getMe) и наружу не отдаются.
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { BACKEND_DIR, parseEnv } from '../config.js'
import { run } from '../exec.js'
import { httpJson } from '../http.js'

type BotDef = {
  id: string
  title: string
  description?: string
  kind: 'alert-monitor' | 'lead-api' | 'generic'
  unit: string
  dir?: string
  entry?: string
  config?: string
  log?: { type: 'file'; path: string } | { type: 'journal'; unit: string }
  runtime?: { type: 'python' | 'node'; bin: string }
  token?: { file: string; json?: string; env?: string }
  links?: { title: string; url: string }[]
}

export async function loadRegistry(): Promise<BotDef[]> {
  return (JSON.parse(await readFile(path.join(BACKEND_DIR, 'bots.json'), 'utf8')) as { bots: BotDef[] }).bots
}

// Токены ботов из реестра (только для сравнения на сервере — наружу не отдаются).
// Файл, который не удалось прочитать, пропускается.
export async function registryTokens(registry?: BotDef[]) {
  const out: { id: string; title: string; token: string }[] = []
  for (const b of registry ?? (await loadRegistry())) {
    const t = b.token
    if (!t) continue
    try {
      const raw = await readFile(t.file, 'utf8')
      const token = t.json ? JSON.parse(raw)[t.json] : t.env ? parseEnv(raw)[t.env] : undefined
      if (typeof token === 'string' && token) out.push({ id: b.id, title: b.title, token: token.trim() })
    } catch {
      /* нет доступа — пропуск */
    }
  }
  return out
}

const cache = new Map<string, { at: number; value: unknown }>()
// failed(value) → true: результат-ошибку держим в кэше только минуту (сетевой сбой не должен «залипать» на час)
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>, failed?: (v: T) => boolean): Promise<T> {
  const c = cache.get(key)
  if (c && Date.now() - c.at < ttlMs) return c.value as T
  const value = await fn()
  cache.set(key, { at: failed?.(value) ? Date.now() - ttlMs + 60_000 : Date.now(), value })
  return value
}

async function fileInfo(p?: string) {
  if (!p) return null
  const st = await stat(p).catch((e: NodeJS.ErrnoException) => (e.code === 'EACCES' ? 'noaccess' : null))
  if (st === 'noaccess') return { path: p, mtime: null, size: null, access: false }
  if (!st) return { path: p, mtime: null, size: null, access: false, missing: true }
  return { path: p, mtime: st.mtimeMs, size: st.isFile() ? st.size : null, access: true }
}

async function unitInfo(unit: string) {
  const out = await run('/usr/bin/systemctl', ['show', unit, '-p', 'ActiveState', '-p', 'SubState', '-p', 'ActiveEnterTimestamp', '-p', 'NRestarts', '-p', 'MainPID', '-p', 'MemoryCurrent'])
  const o = Object.fromEntries(out.trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  const since = Date.parse(String(o.ActiveEnterTimestamp).replace(/ [A-Z]{3,5}$/, ''))
  const mem = Number(o.MemoryCurrent)
  return {
    active: o.ActiveState,
    sub: o.SubState,
    since: o.ActiveState === 'active' && Number.isFinite(since) ? since : null,
    restarts: Number(o.NRestarts) || 0,
    pid: Number(o.MainPID) || null,
    memory: Number.isFinite(mem) && mem > 0 && mem < 2 ** 60 ? mem : null,
  }
}

async function runtimeVersion(rt?: BotDef['runtime']) {
  if (!rt) return null
  return cached(`rt:${rt.bin}`, 3_600_000, async () => {
    const out = await run(rt.bin, ['--version']).catch((e) => (e.stdout as string) || '')
    return `${rt.type === 'python' ? 'Python' : 'Node.js'} ${out.trim().replace(/^Python\s+|^v/, '')}`
  })
}

async function botUsername(t?: BotDef['token']) {
  if (!t) return { username: null, error: 'токен не указан в реестре' }
  return cached(`me:${t.file}`, 3_600_000, async () => {
    let token: string | undefined
    try {
      const raw = await readFile(t.file, 'utf8')
      token = t.json ? JSON.parse(raw)[t.json] : t.env ? parseEnv(raw)[t.env] : undefined
    } catch (e) {
      return { username: null, error: (e as NodeJS.ErrnoException).code === 'EACCES' ? `нет доступа к ${t.file}` : 'файл токена не прочитан' }
    }
    if (!token) return { username: null, error: 'токен не найден в файле' }
    const r = await httpJson<{ ok: boolean; result?: { username: string; first_name: string } }>(`https://api.telegram.org/bot${token}/getMe`, { timeoutMs: 6000 }).catch(
      () => null
    )
    return r?.result ? { username: r.result.username, name: r.result.first_name, error: null } : { username: null, error: 'Telegram не ответил' }
  }, (v) => !v.username)
}

// Хвост лога: только ошибки и предупреждения
async function logProblems(log?: BotDef['log']) {
  if (!log) return []
  if (log.type === 'journal') {
    const out = await run('/usr/bin/journalctl', ['-u', log.unit, '-p', 'warning', '-n', '20', '-o', 'json', '--output-fields=MESSAGE,__REALTIME_TIMESTAMP', '--no-pager']).catch(() => '')
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .map((j) => ({ ts: Math.floor(Number(j.__REALTIME_TIMESTAMP) / 1000), text: String(j.MESSAGE ?? '') }))
  }
  const lines: { ts: number | null; text: string }[] = []
  await eachLine(log.path, (l) => {
    if (/\[(ERROR|WARNING|CRITICAL)\]/.test(l) && !/Аномальная задержка|\[poll\] СОВПАДЕНИЕ/.test(l)) {
      lines.push({ ts: lineTs(l), text: l.replace(/^\S+ \S+ /, '') })
      if (lines.length > 20) lines.shift()
    }
  })
  return lines
}

const lineTs = (l: string) => {
  const m = l.match(/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/)
  return m ? Date.parse(m[1].replace(' ', 'T')) : null
}

// Построчное чтение без загрузки файла целиком в память
async function eachLine(file: string, fn: (line: string) => void) {
  await new Promise<void>((resolve) => {
    const stream = createReadStream(file, { encoding: 'utf8' })
    stream.on('error', () => resolve())
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    rl.on('line', fn)
    rl.on('close', () => resolve())
  })
}

const dayKey = (ts: number) => new Date(ts).toLocaleDateString('sv-SE')

function lastDays(n: number, counts: Map<string, number>) {
  const out: { day: string; count: number }[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = dayKey(Date.now() - i * 86_400_000)
    out.push({ day: d, count: counts.get(d) ?? 0 })
  }
  return out
}

// ---------- бот тревог ----------
async function alertAnalytics(bot: BotDef) {
  return cached(`alert:${bot.id}`, 10 * 60_000, async () => {
    const cfg = JSON.parse(await readFile(bot.config!, 'utf8').catch(() => '{}'))
    const subs = JSON.parse(await readFile(path.join(bot.dir!, 'subscribers.json'), 'utf8').catch(() => '[]'))
    const logPath = (bot.log as { path: string }).path
    const perDay = new Map<string, number>()
    const alerts: { ts: number; reason: string; text: string }[] = []
    const lags: number[] = []
    const dayAgo = Date.now() - 86_400_000
    for (const f of [`${logPath}.1`, logPath]) {
      await eachLine(f, (l) => {
        const ts = lineTs(l)
        if (!ts) return
        const m = l.match(/\[poll\] СОВПАДЕНИЕ \(([^)]*)\): (.*)$/)
        if (m) {
          perDay.set(dayKey(ts), (perDay.get(dayKey(ts)) ?? 0) + 1)
          alerts.push({ ts, reason: m[1], text: m[2].slice(0, 200) })
          if (alerts.length > 10) alerts.shift()
        }
        if (ts > dayAgo && l.includes('⏱ [poll]')) {
          const lag = Number(l.match(/Задержка: ([\d.]+) сек/)?.[1])
          if (Number.isFinite(lag)) lags.push(lag)
        }
      })
    }
    // Ключевые слова и регионы — не секрет, показываем как есть
    const lists: Record<string, string> = {
      cities: 'Город и область',
      fast_threats: 'Быстрые угрозы (ракеты, МиГ-31)',
      slow_threats: 'Медленные угрозы (дроны)',
      national: 'Общенациональные',
      all_clear: 'Отбой',
      far_regions: 'Дальние регионы (игнор)',
      far_directions: 'Дальние направления (игнор)',
    }
    return {
      channel: cfg.monitored_channel ? `@${cfg.monitored_channel}` : null,
      subscribers: Array.isArray(subs) ? subs.length : Object.keys(subs ?? {}).length,
      keywords: Object.entries(lists)
        .filter(([k]) => Array.isArray(cfg[k]))
        .map(([k, title]) => ({ key: k, title, words: cfg[k] as string[] })),
      alertsPerDay: lastDays(30, perDay),
      lastAlerts: alerts.reverse(),
      delivery: lags.length ? { avgSec: Math.round((lags.reduce((a, b) => a + b, 0) / lags.length) * 10) / 10, maxSec: Math.max(...lags), messages: lags.length } : null,
    }
  })
}

// ---------- бот заявок ----------
async function leadAnalytics(bot: BotDef) {
  return cached(`lead:${bot.id}`, 5 * 60_000, async () => {
    const unit = (bot.log as { unit: string }).unit
    const out = await run(
      '/usr/bin/journalctl',
      ['-u', unit, '-S', '-30d', '-o', 'json', '--output-fields=MESSAGE,__REALTIME_TIMESTAMP', '--no-pager', '--grep', '\\[lead\\]|greeted new user|getUpdates error'],
      { timeoutMs: 20_000, maxBuffer: 16 * 1024 * 1024 }
    ).catch((e) => (e.code === 1 ? '' : Promise.reject(e)))
    const perDay = new Map<string, number>()
    const leads: { ts: number; ok: boolean; contact: string | null; task: boolean | null }[] = []
    let rejected = 0
    let greeted = 0
    let pollErrors24h = 0
    const dayAgo = Date.now() - 86_400_000
    for (const line of out.split('\n')) {
      if (!line) continue
      const j = JSON.parse(line)
      const ts = Math.floor(Number(j.__REALTIME_TIMESTAMP) / 1000)
      const msg = String(j.MESSAGE ?? '')
      const m = msg.match(/^\[lead\] (ok|failed) contact=(\w+) task=(yes|no)/)
      if (m) {
        if (m[1] === 'ok') perDay.set(dayKey(ts), (perDay.get(dayKey(ts)) ?? 0) + 1)
        leads.push({ ts, ok: m[1] === 'ok', contact: m[2], task: m[3] === 'yes' })
      } else if (msg.startsWith('[lead] rejected')) rejected++
      else if (msg.includes('greeted new user')) greeted++
      else if (msg.includes('getUpdates error') && ts > dayAgo) pollErrors24h++
    }
    return {
      loggingEnabled: leads.length > 0 || rejected > 0,
      leadsPerDay: lastDays(30, perDay),
      lastLeads: leads.slice(-10).reverse(),
      rejected30d: rejected,
      greeted30d: greeted,
      pollErrors24h,
    }
  })
}

export async function botsOverview() {
  const registry = await loadRegistry()
  return Promise.all(
    registry.map(async (b) => {
      const safe = <T>(p: Promise<T>) => p.then((data) => ({ data, error: null })).catch((e) => ({ data: null, error: (e as Error).message }))
      const [unit, runtime, me, problems, files, analytics] = await Promise.all([
        safe(unitInfo(b.unit)),
        safe(runtimeVersion(b.runtime)),
        safe(botUsername(b.token)),
        safe(logProblems(b.log)),
        safe(Promise.all([fileInfo(b.dir), fileInfo(b.entry), fileInfo(b.config), fileInfo(b.log?.type === 'file' ? b.log.path : undefined)])),
        safe<unknown>(b.kind === 'alert-monitor' ? alertAnalytics(b) : b.kind === 'lead-api' ? leadAnalytics(b) : Promise.resolve(null)),
      ])
      const [dir, entry, config, logFile] = files.data ?? []
      return {
        id: b.id,
        title: b.title,
        description: b.description ?? null,
        kind: b.kind,
        unit: b.unit,
        logSource: b.log ? (b.log.type === 'file' ? `file:${b.log.path}` : `journal:${b.log.unit}`) : null,
        links: b.links ?? [],
        paths: { dir, entry, config, log: logFile ?? (b.log?.type === 'journal' ? { path: `journalctl -u ${b.log.unit}`, mtime: null, size: null, access: true } : null) },
        service: unit,
        runtime,
        telegram: me,
        problems,
        analytics,
      }
    })
  )
}
