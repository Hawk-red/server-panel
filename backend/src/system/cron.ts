import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { run, sudo } from '../exec.js'

// ---------- Разбор расписания ----------
type Field = { any: boolean; set: Set<number> }
type Parsed = { minute: Field; hour: Field; dom: Field; month: Field; dow: Field } | 'reboot'

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}
const NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}

function parseField(expr: string, min: number, max: number): Field {
  const set = new Set<number>()
  const val = (s: string) => (s.toLowerCase() in NAMES ? NAMES[s.toLowerCase()] : Number(s))
  for (const part of expr.split(',')) {
    const [range, stepStr] = part.split('/')
    const step = stepStr ? Number(stepStr) : 1
    let lo = min
    let hi = max
    if (range !== '*') {
      const [a, b] = range.split('-')
      lo = val(a)
      hi = b !== undefined ? val(b) : stepStr ? max : lo
    }
    if (![lo, hi, step].every(Number.isFinite) || step <= 0) throw new Error(`не понимаю поле «${expr}»`)
    for (let v = lo; v <= hi; v += step) set.add(max === 7 && v === 7 ? 0 : v)
  }
  return { any: expr === '*', set }
}

export function parseSchedule(expr: string): Parsed {
  if (expr === '@reboot') return 'reboot'
  const e = MACROS[expr] ?? expr
  const f = e.trim().split(/\s+/)
  if (f.length !== 5) throw new Error('ожидается 5 полей')
  return {
    minute: parseField(f[0], 0, 59),
    hour: parseField(f[1], 0, 23),
    dom: parseField(f[2], 1, 31),
    month: parseField(f[3], 1, 12),
    dow: parseField(f[4], 0, 7),
  }
}

export function nextRun(p: Parsed, from = new Date()): number | null {
  if (p === 'reboot') return null
  const d = new Date(from)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  const dayMatches = (x: Date) => {
    const domOk = p.dom.set.has(x.getDate())
    const dowOk = p.dow.set.has(x.getDay())
    // Семантика cron: если заданы оба поля — достаточно любого
    if (!p.dom.any && !p.dow.any) return domOk || dowOk
    return domOk && dowOk
  }
  for (let day = 0; day < 400; day++) {
    if (p.month.set.has(d.getMonth() + 1) && dayMatches(d)) {
      for (let h = day === 0 ? d.getHours() : 0; h < 24; h++) {
        if (!p.hour.set.has(h)) continue
        const startMin = day === 0 && h === d.getHours() ? d.getMinutes() : 0
        for (let m = startMin; m < 60; m++) {
          if (p.minute.set.has(m)) {
            const r = new Date(d)
            r.setHours(h, m, 0, 0)
            return r.getTime()
          }
        }
      }
    }
    d.setDate(d.getDate() + 1)
    d.setHours(0, 0, 0, 0)
  }
  return null
}

const pad = (n: number) => String(n).padStart(2, '0')
const DOW_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

// Расписание человеческим языком (частые случаи; иначе — исходное выражение)
export function describeSchedule(expr: string): string {
  if (expr === '@reboot') return 'при загрузке системы'
  const e = (MACROS[expr] ?? expr).trim().split(/\s+/)
  if (e.length !== 5) return expr
  const [mi, h, dom, mon, dow] = e
  const isNum = (s: string) => /^\d+$/.test(s)
  const step = (s: string) => s.match(/^\*\/(\d+)$/)?.[1]
  const time = isNum(mi) && isNum(h) ? `${pad(+h)}:${pad(+mi)}` : null
  const rest = `${dom} ${mon}`

  if (mi === '*' && h === '*' && rest === '* *' && dow === '*') return 'каждую минуту'
  if (step(mi) && h === '*' && rest === '* *' && dow === '*') return `каждые ${step(mi)} мин`
  if (/^\d+-\d+\/\d+$/.test(mi) && h === '*' && rest === '* *' && dow === '*') {
    const [, a, , s] = mi.match(/^(\d+)-(\d+)\/(\d+)$/)!
    return `каждые ${s} мин (с :${pad(+a)})`
  }
  if (isNum(mi) && h === '*' && rest === '* *' && dow === '*') return `ежечасно в :${pad(+mi)}`
  if (isNum(mi) && step(h) && rest === '* *' && dow === '*') return `каждые ${step(h)} ч в :${pad(+mi)}`
  if (isNum(mi) && /^\d+-\d+$/.test(h) && rest === '* *' && dow === '*') {
    const [a, b] = h.split('-')
    return `ежечасно в :${pad(+mi)} с ${pad(+a)} до ${pad(+b)} ч`
  }
  if (time && rest === '* *' && dow === '*') return `ежедневно в ${time}`
  if (time && rest === '* *' && /^[\d,-]+$/.test(dow)) {
    const days = [...parseField(dow, 0, 7).set].sort().map((d) => DOW_RU[d])
    if (dow === '1-5') return `по будням в ${time}`
    return `по ${days.join(', ')} в ${time}`
  }
  if (time && isNum(dom) && mon === '*' && dow === '*') return `ежемесячно ${+dom}-го числа в ${time}`
  return expr
}

// ---------- Сбор задач ----------
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

function parseCronText(text: string, source: string, fixedUser: string | null): Omit<CronJob, 'next' | 'lastRun' | 'lastResult' | 'human' | 'kind'>[] {
  const out: Omit<CronJob, 'next' | 'lastRun' | 'lastResult' | 'human' | 'kind'>[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || /^[A-Za-z_]+\s*=/.test(line)) continue
    const parts = line.split(/\s+/)
    const macro = parts[0].startsWith('@')
    const nSched = macro ? 1 : 5
    const schedule = parts.slice(0, nSched).join(' ')
    const user = fixedUser ?? parts[nSched]
    const command = parts.slice(nSched + (fixedUser ? 0 : 1)).join(' ')
    if (!command) continue
    out.push({ source, user, schedule, command })
  }
  return out
}

async function crontabUsers(): Promise<string[]> {
  const passwd = await readFile('/etc/passwd', 'utf8')
  const users = passwd
    .split('\n')
    .map((l) => l.split(':'))
    .filter((f) => f.length > 6 && (Number(f[2]) === 0 || (Number(f[2]) >= 1000 && Number(f[2]) < 60000)))
    .map((f) => f[0])
  return users
}

// Последние запуски cron из журнала: «(user) CMD (command)»
async function cronLastRuns(): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  try {
    const out = await run('/usr/bin/journalctl', ['-t', 'CRON', '-S', '-8d', '-o', 'json', '--output-fields=MESSAGE,__REALTIME_TIMESTAMP', '--no-pager'], {
      timeoutMs: 20_000,
      maxBuffer: 64 * 1024 * 1024,
    })
    for (const line of out.split('\n')) {
      if (!line) continue
      const j = JSON.parse(line)
      const m = String(j.MESSAGE).match(/^\((\S+)\) CMD \((.*)\)$/)
      if (m) map.set(`${m[1]}\u0000${m[2].trim()}`, Math.floor(Number(j.__REALTIME_TIMESTAMP) / 1000))
    }
  } catch {
    // нет доступа к журналу — последние запуски будут «нет данных»
  }
  return map
}

async function listTimers(): Promise<CronJob[]> {
  const timers = JSON.parse(await run('/usr/bin/systemctl', ['list-timers', '--all', '-o', 'json'])) as {
    next: number | null
    last: number | null
    unit: string
    activates: string
  }[]
  const services = timers.map((t) => t.activates).filter(Boolean)
  const results = new Map<string, string>()
  if (services.length) {
    const out = await run('/usr/bin/systemctl', ['show', '-p', 'Id,Result,ExecMainStatus', ...services])
    for (const block of out.split('\n\n')) {
      const o = Object.fromEntries(block.split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
      if (o.Id) results.set(o.Id, o.Result === 'success' ? 'успешно' : `ошибка (${o.Result}, код ${o.ExecMainStatus})`)
    }
  }
  const us = (v: number | null) => (v && v > 0 ? Math.floor(v / 1000) : null)
  return timers.map((t) => ({
    kind: 'timer',
    source: 'systemd',
    user: 'root',
    schedule: t.unit,
    human: 'systemd-таймер',
    command: t.activates,
    next: us(t.next),
    lastRun: us(t.last),
    lastResult: us(t.last) ? (results.get(t.activates) ?? null) : null,
  }))
}

export async function listCron(): Promise<{ jobs: CronJob[]; errors: string[] }> {
  const errors: string[] = []
  const raw: ReturnType<typeof parseCronText> = []

  try {
    raw.push(...parseCronText(await readFile('/etc/crontab', 'utf8'), '/etc/crontab', null))
  } catch (e) {
    errors.push(`/etc/crontab: ${(e as Error).message}`)
  }
  try {
    for (const f of await readdir('/etc/cron.d')) {
      if (f.startsWith('.') || f.includes('~')) continue
      raw.push(...parseCronText(await readFile(path.join('/etc/cron.d', f), 'utf8'), `/etc/cron.d/${f}`, null))
    }
  } catch (e) {
    errors.push(`/etc/cron.d: ${(e as Error).message}`)
  }
  for (const user of await crontabUsers().catch(() => ['root'])) {
    try {
      const text = await sudo(['/usr/bin/crontab', '-l', '-u', user], { timeoutMs: 5000 })
      raw.push(...parseCronText(text, `crontab ${user}`, user))
    } catch (e) {
      const msg = (e as Error).message
      if (/no crontab for/i.test(msg)) continue
      errors.push(`crontab ${user}: ${/password is required|not allowed/i.test(msg) ? 'нет прав (sudoers)' : msg}`)
    }
  }

  const lastRuns = await cronLastRuns()
  const jobs: CronJob[] = raw.map((j) => {
    let next: number | null = null
    let error: string | undefined
    try {
      next = nextRun(parseSchedule(j.schedule))
    } catch (e) {
      error = (e as Error).message
    }
    const last = lastRuns.get(`${j.user}\u0000${j.command}`) ?? null
    return { ...j, kind: 'cron', human: describeSchedule(j.schedule), next, lastRun: last, lastResult: last ? 'запущено' : null, error }
  })

  try {
    jobs.push(...(await listTimers()))
  } catch (e) {
    errors.push(`systemd-таймеры: ${(e as Error).message}`)
  }
  jobs.sort((a, b) => (a.next ?? Infinity) - (b.next ?? Infinity))
  return { jobs, errors }
}
