import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { run } from '../exec.js'

// ---------- модель и проверка входных данных ----------
export const KINDS = ['link', 'http', 'tcp', 'ping', 'homeassistant'] as const
export type Kind = (typeof KINDS)[number]
export const ICON_IDS = ['lamp', 'socket', 'sensor', 'camera', 'lock', 'ac', 'tv', 'router', 'speaker', 'other'] as const
export const ICONS = ICON_IDS
export const MAX_DEVICES = 60 // порядок карточек хранится общим механизмом страниц: до 60 id

export type DeviceInput = {
  name: string
  kind: Kind
  room: string | null
  icon: (typeof ICONS)[number]
  host: string | null
  port: number | null
  url: string | null
  notes: string | null
  enabled: boolean
}
export type Checked = { ok: true; value: DeviceInput } | { ok: false; field: string; message: string }

// IP или имя хоста: буквы, цифры, точки и дефисы; пробелов и shell-символов нет
const HOSTNAME_RE = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/
export const validHost = (h: string) => net.isIP(h) !== 0 || HOSTNAME_RE.test(h)

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

// Адрес из ссылки: только http/https, без логина-пароля; IPv6 приходит в скобках
export function parseUrl(raw: string): URL | null {
  if (raw.length > 300) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return null
  return u
}
export const urlHost = (u: URL) => u.hostname.replace(/^\[|\]$/g, '')
export const urlPort = (u: URL) => (u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80)

export function validateDevice(raw: unknown): Checked {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const bad = (field: string, message: string): Checked => ({ ok: false, field, message })

  const name = str(b.name)
  if (name.length < 1 || name.length > 60) return bad('name', 'Название: от 1 до 60 символов')
  const kind = b.kind as Kind
  if (!KINDS.includes(kind)) return bad('kind', 'Неизвестный тип устройства')
  const room = str(b.room)
  if (room.length > 40) return bad('room', 'Комната: не длиннее 40 символов')
  const icon = (b.icon ?? 'other') as DeviceInput['icon']
  if (!ICONS.includes(icon)) return bad('icon', 'Неизвестный значок')
  const notes = str(b.notes)
  if (notes.length > 300) return bad('notes', 'Заметка: не длиннее 300 символов')

  const host = str(b.host)
  if (host && !validHost(host)) return bad('host', 'Адрес: только IP или имя хоста, без пробелов и спецсимволов')
  let port: number | null = null
  if (b.port !== undefined && b.port !== null && b.port !== '') {
    port = Number(b.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return bad('port', 'Порт: число от 1 до 65535')
  }
  const rawUrl = str(b.url)
  let url: string | null = null
  if (rawUrl) {
    const u = parseUrl(rawUrl)
    if (!u) return bad('url', 'Ссылка: только http:// или https://, без логина и пароля')
    if (!validHost(urlHost(u))) return bad('url', 'Ссылка: недопустимый адрес')
    url = u.toString()
  }

  // Какие поля нужны каждому типу
  if (kind === 'link' && !url) return bad('url', 'Для ссылки укажите адрес http:// или https://')
  if (kind === 'http' && !url && !host) return bad('host', 'Укажите ссылку или адрес устройства')
  if ((kind === 'tcp') && (!host || port === null)) return bad(host ? 'port' : 'host', 'Для проверки порта нужны адрес и порт')
  if (kind === 'ping' && !host) return bad('host', 'Укажите адрес устройства')

  return {
    ok: true,
    value: {
      name,
      kind,
      room: room || null,
      icon,
      host: host || null,
      port,
      url,
      notes: notes || null,
      enabled: b.enabled === undefined ? true : b.enabled === true,
    },
  }
}

// ---------- только локальная сеть (защита от SSRF) ----------
const PRIVATE = new net.BlockList()
PRIVATE.addSubnet('10.0.0.0', 8, 'ipv4')
PRIVATE.addSubnet('172.16.0.0', 12, 'ipv4')
PRIVATE.addSubnet('192.168.0.0', 16, 'ipv4')
PRIVATE.addSubnet('127.0.0.0', 8, 'ipv4')
PRIVATE.addAddress('::1', 'ipv6')
PRIVATE.addSubnet('fc00::', 7, 'ipv6')

export function isPrivateIp(ip: string): boolean {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i) // IPv4 внутри IPv6
  const addr = mapped ? mapped[1] : ip
  const fam = net.isIP(addr)
  if (fam === 0) return false
  return PRIVATE.check(addr, fam === 4 ? 'ipv4' : 'ipv6')
}

export const NOT_LOCAL = 'адрес не из локальной сети (разрешены 10.x, 172.16–31.x, 192.168.x и localhost)'

type LookupAll = (host: string, opts: { all: true }, cb: (err: NodeJS.ErrnoException | null, addrs: dns.LookupAddress[]) => void) => void

// Разрешение имени с проверкой: любой публичный адрес в ответе — отказ. Подключение идёт ровно по проверенному адресу
// (передаётся как lookup в http/net), поэтому подмена DNS между проверкой и соединением невозможна.
export function guardedLookup(base: LookupAll = dns.lookup as unknown as LookupAll) {
  return ((hostname: string, options: dns.LookupOptions, cb: (...a: unknown[]) => void) => {
    if (net.isIP(hostname)) {
      if (!isPrivateIp(hostname)) return cb(new Error(NOT_LOCAL))
      return options?.all ? cb(null, [{ address: hostname, family: net.isIP(hostname) }]) : cb(null, hostname, net.isIP(hostname))
    }
    base(hostname, { all: true }, (err, addrs) => {
      if (err) return cb(err)
      if (!addrs.length || addrs.some((a) => !isPrivateIp(a.address))) return cb(new Error(NOT_LOCAL))
      return options?.all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family)
    })
  }) as unknown as net.LookupFunction
}

// Проверка при сохранении: IP-адрес должен быть локальным; имя, которое уже разрешается в публичный адрес, отклоняется.
// Имя, которое не разрешилось (устройство выключено, mDNS), сохраняется: проверка повторится при каждом соединении.
export async function assertLocal(host: string, base: LookupAll = dns.lookup as unknown as LookupAll): Promise<void> {
  if (net.isIP(host)) {
    if (!isPrivateIp(host)) throw new Error(NOT_LOCAL)
    return
  }
  const addrs = await new Promise<dns.LookupAddress[]>((resolve) => base(host, { all: true }, (err, a) => resolve(err ? [] : a)))
  if (addrs.some((a) => !isPrivateIp(a.address))) throw new Error(NOT_LOCAL)
}

// ---------- что и как проверять ----------
export type Probe = { method: 'tcp'; host: string; port: number } | { method: 'http'; url: string } | { method: 'ping'; host: string }
type DeviceLike = Pick<DeviceInput, 'kind' | 'host' | 'port' | 'url'>

export function probeFor(d: DeviceLike): Probe | null {
  const u = d.url ? parseUrl(d.url) : null
  switch (d.kind) {
    case 'link':
      return u ? { method: 'tcp', host: urlHost(u), port: urlPort(u) } : null
    case 'http':
      if (u) return { method: 'http', url: u.toString() }
      return d.host ? { method: 'http', url: `http://${net.isIPv6(d.host) ? `[${d.host}]` : d.host}:${d.port ?? 80}/` } : null
    case 'tcp':
      return d.host && d.port ? { method: 'tcp', host: d.host, port: d.port } : null
    case 'ping':
      return d.host ? { method: 'ping', host: d.host } : null
    case 'homeassistant':
      if (u) return { method: 'http', url: u.toString() }
      return d.host ? { method: 'tcp', host: d.host, port: d.port ?? 8123 } : null
  }
}

export type Status = {
  state: 'online' | 'offline' | 'unknown' | 'disabled' | 'checking'
  checkedAt: number | null
  latencyMs: number | null
  detail: string | null
}
export const TIMEOUT_MS = 1500

type Impl = {
  tcp: (host: string, port: number, ms: number) => Promise<void>
  http: (url: string, ms: number) => Promise<number>
  ping: (host: string, ms: number) => Promise<void>
}

// Для IP-адреса Node вообще не вызывает lookup, поэтому литералы проверяются отдельно до соединения
const guardLiteral = (host: string) => {
  if (net.isIP(host) && !isPrivateIp(host)) throw new Error(NOT_LOCAL)
}

export const realImpl: Impl = {
  tcp: (host, port, ms) =>
    new Promise((resolve, reject) => {
      guardLiteral(host)
      const s = net.connect({ host, port, lookup: guardedLookup() })
      const done = (e?: Error) => {
        s.destroy()
        e ? reject(e) : resolve()
      }
      s.setTimeout(ms, () => done(new Error('таймаут')))
      s.once('connect', () => done())
      s.once('error', done)
    }),
  http: (url, ms) =>
    new Promise((resolve, reject) => {
      guardLiteral(urlHost(new URL(url)))
      const lib = url.startsWith('https:') ? https : http
      // Самоподписанные сертификаты у устройств обычны; тело ответа не читается и не сохраняется, редиректы не выполняются
      const req = lib.request(url, { method: 'GET', timeout: ms, lookup: guardedLookup(), rejectUnauthorized: false, headers: { 'User-Agent': 'server-panel-smarthome/1' } }, (res) => {
        res.destroy()
        resolve(res.statusCode ?? 0)
      })
      req.once('timeout', () => req.destroy(new Error('таймаут')))
      req.once('error', reject)
      req.end()
    }),
  ping: async (host, ms) => {
    guardLiteral(host)
    const addr = await new Promise<string>((resolve, reject) =>
      guardedLookup()(host, {}, ((err: Error | null, a: string) => (err ? reject(err) : resolve(a))) as never)
    )
    await run('/usr/bin/ping', ['-n', '-c', '1', '-W', '1', addr], { timeoutMs: ms + 500 })
  },
}

const errText = (e: unknown) => {
  const m = (e as Error)?.message ?? ''
  if (m.includes('локальной сети')) return 'адрес не из локальной сети'
  return (e as NodeJS.ErrnoException)?.code || m.split('\n')[0] || 'нет ответа'
}

// Одна проверка: online/offline с задержкой. Ничего не отправляет устройству, кроме открытия соединения / GET / ping
export async function check(p: Probe, impl: Impl = realImpl, now: () => number = Date.now): Promise<Status> {
  const t0 = now()
  try {
    let detail: string | null = null
    if (p.method === 'tcp') await impl.tcp(p.host, p.port, TIMEOUT_MS)
    else if (p.method === 'http') detail = `HTTP ${await impl.http(p.url, TIMEOUT_MS)}`
    else await impl.ping(p.host, TIMEOUT_MS)
    return { state: 'online', checkedAt: now(), latencyMs: Math.max(0, now() - t0), detail }
  } catch (e) {
    return { state: 'offline', checkedAt: now(), latencyMs: null, detail: errText(e) }
  }
}

// ---------- кэш состояний ----------
// Не чаще одной проверки на устройство за ttl (20 с); проверка идёт в фоне, запрос списка её не ждёт.
export function createStatusCache(opts: { ttlMs?: number; now?: () => number; probe?: (p: Probe) => Promise<Status> } = {}) {
  const ttl = opts.ttlMs ?? 20_000
  const now = opts.now ?? Date.now
  const probe = opts.probe ?? ((p: Probe) => check(p))
  const cache = new Map<number, { status: Status; key: string }>()
  const inflight = new Set<number>()
  const key = (d: DeviceLike) => JSON.stringify(probeFor(d))

  return {
    // Текущее состояние из кэша; если устарело — запускает фоновую проверку (возвращённый промис нужен только тестам)
    get(id: number, d: DeviceLike & { enabled: boolean }): { status: Status; pending: Promise<void> | null } {
      if (!d.enabled) return { status: { state: 'disabled', checkedAt: null, latencyMs: null, detail: null }, pending: null }
      const p = probeFor(d)
      if (!p) return { status: { state: 'unknown', checkedAt: null, latencyMs: null, detail: 'нечего проверять' }, pending: null }
      const k = key(d)
      const hit = cache.get(id)
      const fresh = hit && hit.key === k && hit.status.checkedAt !== null && now() - hit.status.checkedAt < ttl
      let pending: Promise<void> | null = null
      if (!fresh && !inflight.has(id)) {
        inflight.add(id)
        pending = probe(p)
          .then((s) => void cache.set(id, { status: s, key: k }))
          .catch(() => undefined)
          .finally(() => inflight.delete(id))
      }
      const status = hit && hit.key === k ? hit.status : { state: 'checking' as const, checkedAt: null, latencyMs: null, detail: null }
      return { status, pending }
    },
    forget(id: number) {
      cache.delete(id)
    },
  }
}
