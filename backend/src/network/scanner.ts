// Сканер локальной сети 192.168.31.0/24.
// Обнаружение: nmap -sn (без root) + ARP-таблица ядра (ip neigh) + arp-scan через helper, если установлен.
// Имена: mDNS (avahi) и NetBIOS. Производитель — по OUI из баз nmap / ieee-data.
// Каждый шаг в своём try/catch: сбой одного источника не мешает остальным.
import { readFile } from 'node:fs/promises'
import type { FastifyBaseLogger } from 'fastify'
import { db } from '../db.js'
import { emitEvent } from '../events.js'
import { run, sudo } from '../exec.js'

export const SUBNET = '192.168.31.0/24'
const IFACE = 'enp3s0f0'
const SELF_IP = '192.168.31.112'

// Заранее подписанные устройства (по IP при первом появлении)
const PRESETS: Record<string, { name: string; type: DeviceType }> = {
  '192.168.31.1': { name: 'Роутер Xiaomi', type: 'router' },
  '192.168.31.112': { name: 'Mac Mini (этот сервер)', type: 'unknown' },
  '192.168.31.146': { name: 'MacBook Pro M1 (кабель)', type: 'laptop' },
  '192.168.31.51': { name: 'MacBook Pro M1 (Wi-Fi)', type: 'laptop' },
  '192.168.31.82': { name: 'Ugoos SK1 (Android TV)', type: 'tv' },
  '192.168.31.94': { name: 'Marantz NR1604', type: 'media' },
  '192.168.31.181': { name: 'Samsung 7 Series (ТВ)', type: 'tv' },
}

// Типы: телефон и планшет — один тип «phone»; «media» — ресиверы и аудио; «unknown» — «Другое» (принтеры, компьютеры, серверы и всё нераспознанное)
export type DeviceType = 'router' | 'laptop' | 'phone' | 'tv' | 'media' | 'iot' | 'unknown'
export const TYPE_LABEL: Record<DeviceType, string> = {
  router: 'Роутер / сеть', laptop: 'Ноутбук', phone: 'Телефон / планшет', tv: 'ТВ', media: 'Медиа', iot: 'Умный дом', unknown: 'Другое',
}

// Прежние типы, которые убрали из списка → куда переносятся (ir — ближайший по смыслу «Умный дом»)
const RETIRED: Record<string, DeviceType> = { tablet: 'phone', receiver: 'media', ir: 'iot', printer: 'unknown', desktop: 'unknown', server: 'unknown' }

// Разовая (идемпотентная) переброска уже сохранённых устройств; каждое изменение пишется в журнал событий
export function migrateDeviceTypes() {
  const rows = db.prepare('SELECT mac, ip, name, hostname, vendor, type FROM devices').all() as { mac: string; ip: string | null; name: string | null; hostname: string | null; vendor: string | null; type: string | null }[]
  const upd = db.prepare('UPDATE devices SET type = ? WHERE mac = ?')
  for (const d of rows) {
    const to = d.type ? RETIRED[d.type] : undefined
    if (!to) continue
    upd.run(to, d.mac)
    const label = d.name ?? d.hostname ?? d.vendor ?? d.mac
    emitEvent({ kind: 'device.retype', level: 'info', text: `Тип устройства «${label}» (${d.ip ?? d.mac}): ${d.type} → ${TYPE_LABEL[to]}`, target: d.mac, details: { from: d.type, to } })
  }
}

type Found = { ip: string; mac: string; vendor?: string | null }

let log: FastifyBaseLogger | undefined
export const status = {
  lastDiscovery: null as number | null,
  lastDiscoveryError: null as string | null,
  arpScan: null as boolean | null, // null — ещё не проверяли
  scanning: null as { mac: string; ip: string; started: number } | null,
  nightly: { lastRun: null as string | null, running: false },
}

const isRandomMac = (mac: string) => (parseInt(mac.slice(0, 2), 16) & 2) !== 0

// ---------- производитель ----------
const vendorCache = new Map<string, string | null>()
async function lookupVendor(mac: string): Promise<string | null> {
  const prefix = mac.replace(/:/g, '').slice(0, 6).toUpperCase()
  if (vendorCache.has(prefix)) return vendorCache.get(prefix)!
  let vendor: string | null = null
  try {
    vendor = (await run('/usr/bin/grep', ['-m1', `^${prefix} `, '/usr/share/nmap/nmap-mac-prefixes'])).trim().slice(7) || null
  } catch {
    /* нет совпадения */
  }
  if (!vendor) {
    try {
      const dashed = prefix.match(/../g)!.join('-')
      const line = (await run('/usr/bin/grep', ['-m1', `^${dashed}`, '/usr/share/ieee-data/oui.txt'])).trim()
      vendor = line.split('\t').pop()?.trim() || null
    } catch {
      /* нет совпадения */
    }
  }
  vendorCache.set(prefix, vendor)
  return vendor
}

// ---------- тип по производителю/имени ----------
function guessType(ip: string, vendor: string | null, hostname: string | null, random: boolean): DeviceType {
  const v = (vendor ?? '').toLowerCase()
  const h = (hostname ?? '').toLowerCase()
  if (ip.endsWith('.1')) return 'router'
  if (/broadlink/.test(v)) return 'iot'
  if (/ipad/.test(h)) return 'phone'
  if (/iphone|android|pixel|galaxy/.test(h)) return h.includes('android') ? 'tv' : 'phone'
  if (/macbook|laptop|thinkpad/.test(h)) return 'laptop'
  if (/d&m|denon|marantz|yamaha|onkyo/.test(v)) return 'media'
  if (/samsung electronics|lg electronics|sony|tcl|hisense/.test(v) && /tv|samsung\./.test(h)) return 'tv'
  if (/espressif|tuya|shelly|sonoff|bilian|xiaomi electronics|lumi/.test(v)) return 'iot'
  if (/hewlett|canon|epson|brother|kyocera/.test(v)) return 'unknown'
  if (random) return 'phone'
  return 'unknown'
}

// ---------- источники ----------
async function nmapSweep(): Promise<Set<string>> {
  const out = await run('/usr/bin/nmap', ['-sn', '-n', '-T4', SUBNET, '-oG', '-'], { timeoutMs: 60_000 })
  return new Set([...out.matchAll(/^Host: (\S+) .*Status: Up/gm)].map((m) => m[1]))
}

async function arpScan(): Promise<Found[]> {
  const out = await sudo(['/usr/local/sbin/server-panel-helper', 'arp-scan'], { timeoutMs: 60_000 })
  status.arpScan = true
  return out
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((f) => /^\d+\.\d+\.\d+\.\d+$/.test(f[0]) && /^[0-9a-f:]{17}$/i.test(f[1] ?? ''))
    .map((f) => ({ ip: f[0], mac: f[1].toLowerCase(), vendor: f[2] && !/unknown/i.test(f[2]) ? f[2] : null }))
}

async function neighbours(): Promise<{ ip: string; mac: string; fresh: boolean }[]> {
  const list = JSON.parse(await run('/usr/bin/ip', ['-j', 'neigh', 'show', 'dev', IFACE])) as { dst: string; lladdr?: string; state?: string[] }[]
  return list
    .filter((n) => n.lladdr && /^\d+\.\d+\.\d+\.\d+$/.test(n.dst) && !n.state?.includes('FAILED'))
    .map((n) => ({ ip: n.dst, mac: n.lladdr!.toLowerCase(), fresh: Boolean(n.state?.some((s) => ['REACHABLE', 'DELAY', 'PROBE'].includes(s))) }))
}

// mDNS: IP → имя.local (кэш 15 мин — avahi-browse занимает несколько секунд)
let mdnsCache: { at: number; map: Map<string, string> } | null = null
async function mdnsNames(): Promise<Map<string, string>> {
  if (mdnsCache && Date.now() - mdnsCache.at < 15 * 60_000) return mdnsCache.map
  const out = await run('/usr/bin/avahi-browse', ['-a', '-r', '-t', '-p'], { timeoutMs: 15_000 }).catch((e) => (e.stdout as string) ?? '')
  const map = new Map<string, string>()
  for (const l of out.split('\n')) {
    const f = l.split(';')
    if (f[0] === '=' && f[2] === 'IPv4' && f[7]?.startsWith('192.168.31.')) map.set(f[7], f[6].replace(/\.local$/, ''))
  }
  mdnsCache = { at: Date.now(), map }
  return map
}

async function netbiosName(ip: string): Promise<string | null> {
  const out = await run('/usr/bin/nmblookup', ['-A', ip], { timeoutMs: 6000 }).catch(() => '')
  return out.match(/^\s+(\S+)\s+<00> -\s+(?!<GROUP>)/m)?.[1] ?? null
}

// ---------- обнаружение ----------
const q = {
  get: db.prepare('SELECT * FROM devices WHERE mac = ?'),
  insert: db.prepare(
    `INSERT INTO devices (mac, ip, vendor, random_mac, hostname, name, type, known, online, first_seen, last_seen)
     VALUES (@mac, @ip, @vendor, @random_mac, @hostname, @name, @type, @known, 1, @now, @now)`
  ),
  seen: db.prepare(
    `UPDATE devices SET ip = @ip, online = 1, last_seen = @now,
       vendor = COALESCE(vendor, @vendor), hostname = COALESCE(@hostname, hostname) WHERE mac = @mac`
  ),
  offlineAll: db.prepare('UPDATE devices SET online = 0 WHERE mac NOT IN (SELECT value FROM json_each(?))'),
}

async function selfMac() {
  return (await readFile(`/sys/class/net/${IFACE}/address`, 'utf8')).trim().toLowerCase()
}

export async function discover() {
  const now = Date.now()
  const found = new Map<string, Found & { hostname?: string | null }>()

  // 1. nmap -sn будит ARP; 2. arp-scan (если есть); 3. таблица соседей ядра
  const up = await nmapSweep().catch((e) => {
    log?.warn({ err: (e as Error).message }, 'nmap -sn не отработал')
    return new Set<string>()
  })
  if (status.arpScan !== false) {
    try {
      for (const f of await arpScan()) found.set(f.mac, f)
    } catch {
      status.arpScan = false // не установлен или нет прав — работаем без него
    }
  }
  for (const n of await neighbours().catch(() => [])) {
    if ((n.fresh || up.has(n.ip)) && !found.has(n.mac)) found.set(n.mac, { ip: n.ip, mac: n.mac })
  }
  found.set(await selfMac(), { ip: SELF_IP, mac: await selfMac(), hostname: 'macmini-Macmini' })

  const mdns = await mdnsNames().catch(() => new Map<string, string>())
  // NetBIOS-имена для новых устройств без mDNS-имени — параллельно (каждый запрос до 6 с)
  const netbios = new Map<string, string | null>()
  await Promise.all(
    [...found.values()]
      .filter((f) => !f.hostname && !mdns.has(f.ip) && !q.get.get(f.mac))
      .map(async (f) => netbios.set(f.mac, await netbiosName(f.ip)))
  )
  const onlineMacs: string[] = []
  for (const f of found.values()) {
    onlineMacs.push(f.mac)
    const existing = q.get.get(f.mac) as { hostname: string | null; vendor: string | null } | undefined
    let hostname = f.hostname ?? mdns.get(f.ip) ?? null
    const vendor = f.vendor ?? existing?.vendor ?? (await lookupVendor(f.mac))
    if (!existing) {
      if (!hostname) hostname = netbios.get(f.mac) ?? null
      const random = isRandomMac(f.mac)
      const preset = PRESETS[f.ip]
      q.insert.run({
        mac: f.mac,
        ip: f.ip,
        vendor,
        random_mac: random ? 1 : 0,
        hostname,
        name: preset?.name ?? (/broadlink/i.test(vendor ?? '') ? 'ИК-передатчик BroadLink (предположительно)' : null),
        type: preset?.type ?? guessType(f.ip, vendor, hostname, random),
        known: preset ? 1 : 0,
        now,
      })
      if (!preset && status.lastDiscovery) {
        const type = guessType(f.ip, vendor, hostname, random)
        emitEvent({
          kind: 'device.new',
          level: 'warning',
          text: `В сети новое устройство: ${f.ip} · ${f.mac}${vendor ? ` · ${vendor}` : ''}${hostname ? ` · ${hostname}` : ''}`,
          target: f.mac,
          // подробности нужны Telegram-уведомлению (notifier.ts)
          details: { ip: f.ip, mac: f.mac, vendor, hostname, type, random, ts: now },
        })
      }
    } else {
      q.seen.run({ mac: f.mac, ip: f.ip, vendor, hostname, now })
    }
  }
  q.offlineAll.run(JSON.stringify(onlineMacs))
  status.lastDiscovery = now
  status.lastDiscoveryError = null
  return onlineMacs.length
}

// ---------- порты ----------
const WEB_PORTS = new Set([80, 443, 3000, 5000, 5001, 8000, 8008, 8080, 8081, 8090, 8096, 8443, 8888, 9000, 9090])
const portsQ = {
  clear: db.prepare('DELETE FROM device_ports WHERE mac = ?'),
  add: db.prepare('INSERT INTO device_ports (mac, port, proto, service) VALUES (?, ?, ?, ?)'),
  stamp: db.prepare('UPDATE devices SET ports_scanned_at = ? WHERE mac = ?'),
}

export async function scanPorts(mac: string) {
  const dev = q.get.get(mac) as { ip: string; mac: string } | undefined
  if (!dev) throw Object.assign(new Error('устройство не найдено'), { statusCode: 404 })
  if (status.scanning) throw Object.assign(new Error(`уже идёт сканирование ${status.scanning.ip}`), { statusCode: 409 })
  status.scanning = { mac, ip: dev.ip, started: Date.now() }
  try {
    // -sT: TCP connect, работает без root; top-1000 портов.
    // -Pn: без предварительной проверки «жив ли хост» — телефоны и IoT не отвечают на TCP-пинг 80/443,
    //      и nmap без -Pn считал их «down» и сразу завершался с пустым списком (кнопка «не срабатывала»).
    const xml = await run('/usr/bin/nmap', ['-sT', '-Pn', '-T4', '-n', '--top-ports', '1000', '--open', '--host-timeout', '180s', '-oX', '-', dev.ip], {
      timeoutMs: 4 * 60_000,
    })
    const ports = [...xml.matchAll(/<port protocol="(\w+)" portid="(\d+)"><state state="open"[^>]*\/>(?:<service name="([^"]*)")?/g)].map((m) => ({
      proto: m[1],
      port: Number(m[2]),
      service: m[3] ?? null,
    }))
    db.transaction(() => {
      portsQ.clear.run(mac)
      for (const p of ports) portsQ.add.run(mac, p.port, p.proto, p.service)
      portsQ.stamp.run(Date.now(), mac)
    })()
    return ports
  } finally {
    status.scanning = null
  }
}

// Ночное сканирование портов всех онлайн-устройств (03:30, не в 05:00 — там синк)
export async function nightlyIfDue() {
  const now = new Date()
  const today = now.toLocaleDateString('sv-SE') // ГГГГ-ММ-ДД в местном времени
  if (now.getHours() !== 3 || now.getMinutes() < 30 || status.nightly.lastRun === today || status.nightly.running) return
  status.nightly.running = true
  status.nightly.lastRun = today
  try {
    const macs = (db.prepare('SELECT mac FROM devices WHERE online = 1 ORDER BY ip').all() as { mac: string }[]).map((r) => r.mac)
    for (const mac of macs) {
      try {
        await scanPorts(mac)
      } catch (e) {
        log?.warn({ mac, err: (e as Error).message }, 'ночное сканирование портов: пропуск устройства')
      }
    }
    log?.info({ devices: macs.length }, 'ночное сканирование портов завершено')
  } finally {
    status.nightly.running = false
  }
}

export function listDevices() {
  // Порядок, выставленный перетаскиванием (sort_order), иначе — по последнему октету IP
  const devices = db
    .prepare('SELECT * FROM devices ORDER BY sort_order IS NULL, sort_order, CAST(substr(ip, 12) AS INTEGER)')
    .all() as Record<string, unknown>[]
  const ports = db.prepare('SELECT * FROM device_ports ORDER BY port').all() as { mac: string; port: number; proto: string; service: string | null }[]
  return devices.map((d) => ({
    mac: d.mac,
    ip: d.ip,
    vendor: d.vendor,
    randomMac: Boolean(d.random_mac),
    hostname: d.hostname,
    name: d.name,
    type: d.type,
    known: Boolean(d.known),
    online: Boolean(d.online),
    firstSeen: d.first_seen,
    lastSeen: d.last_seen,
    portsScannedAt: d.ports_scanned_at,
    sortOrder: d.sort_order,
    location: d.location,
    note: d.note,
    ports: ports.filter((p) => p.mac === d.mac).map((p) => ({ port: p.port, proto: p.proto, service: p.service, web: WEB_PORTS.has(p.port) || /http/.test(p.service ?? '') })),
  }))
}

export function updateDevice(mac: string, patch: { name?: string | null; type?: DeviceType; known?: boolean; location?: string | null; note?: string | null }) {
  const cur = q.get.get(mac)
  if (!cur) throw Object.assign(new Error('устройство не найдено'), { statusCode: 404 })
  if (patch.name !== undefined) db.prepare('UPDATE devices SET name = ? WHERE mac = ?').run(patch.name?.trim() || null, mac)
  if (patch.type !== undefined) db.prepare('UPDATE devices SET type = ? WHERE mac = ?').run(patch.type, mac)
  if (patch.known !== undefined) db.prepare('UPDATE devices SET known = ? WHERE mac = ?').run(patch.known ? 1 : 0, mac)
  if (patch.location !== undefined) db.prepare('UPDATE devices SET location = ? WHERE mac = ?').run(patch.location?.trim() || null, mac)
  if (patch.note !== undefined) db.prepare('UPDATE devices SET note = ? WHERE mac = ?').run(patch.note?.trim() || null, mac)
}

// Порядок карточек (перетаскивание) — на сервере, одинаково на всех устройствах
export function reorderDevices(macs: string[]) {
  const q = db.prepare('UPDATE devices SET sort_order = ? WHERE mac = ?')
  db.transaction(() => macs.forEach((mac, i) => q.run(i, mac)))()
}

export function deleteDevice(mac: string) {
  db.prepare('DELETE FROM device_ports WHERE mac = ?').run(mac)
  db.prepare('DELETE FROM devices WHERE mac = ?').run(mac)
}

export function summary() {
  const r = db.prepare('SELECT COUNT(*) AS total, SUM(online) AS online, SUM(CASE WHEN known = 0 THEN 1 ELSE 0 END) AS unknown FROM devices').get() as {
    total: number
    online: number | null
    unknown: number | null
  }
  return { total: r.total, online: r.online ?? 0, unknown: r.unknown ?? 0 }
}

export function startScanner(logger: FastifyBaseLogger) {
  log = logger
  try {
    migrateDeviceTypes()
  } catch (e) {
    log.warn({ err: (e as Error).message }, 'не удалось перенести типы устройств')
  }
}
