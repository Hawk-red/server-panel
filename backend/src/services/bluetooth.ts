import { run, sudo } from '../exec.js'

// Bluetooth через bluetoothctl. Чтение — от пользователя панели (D-Bus разрешает);
// включение/выключение и сканирование — только через sudo с точными командами (deploy/sudoers-server-panel).
const BTCTL = '/usr/bin/bluetoothctl'
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
const clean = (s: string) => s.replace(ANSI, '').replace(/\r/g, '')

export type BtAdapter = { name: string | null; address: string | null; powered: boolean; discoverable: boolean; pairable: boolean }
export type BtDevice = { mac: string; name: string; icon: string | null; paired: boolean; trusted: boolean; blocked: boolean; connected: boolean; battery: number | null; rssi?: number | null }

const kv = (text: string) => {
  const o: Record<string, string> = {}
  for (const line of clean(text).split('\n')) {
    const m = line.match(/^\s*([A-Za-z ]+?):\s*(.*)$/)
    if (m && !(m[1] in o)) o[m[1].trim()] = m[2].trim()
  }
  return o
}
const yes = (v?: string) => v === 'yes'

export async function adapter(): Promise<BtAdapter | null> {
  const out = await run(BTCTL, ['show']).catch(() => '')
  if (!out.trim()) return null
  const o = kv(out)
  const addr = clean(out).match(/^Controller (\S+)/m)?.[1] ?? null
  return { name: o.Name ?? null, address: addr, powered: yes(o.Powered), discoverable: yes(o.Discoverable), pairable: yes(o.Pairable) }
}

// Сведения об устройстве: bluetoothctl info <MAC>
async function info(mac: string): Promise<BtDevice> {
  const out = await run(BTCTL, ['info', mac]).catch(() => '')
  const o = kv(out)
  const batt = o['Battery Percentage']?.match(/\((\d+)\)/)
  const name = o.Alias ?? o.Name ?? mac
  return {
    mac,
    name,
    icon: o.Icon ?? null,
    paired: yes(o.Paired),
    trusted: yes(o.Trusted),
    blocked: yes(o.Blocked),
    connected: yes(o.Connected),
    battery: batt ? Number(batt[1]) : null,
  }
}

const parseDevices = (text: string) =>
  clean(text)
    .split('\n')
    .map((l) => l.trim().match(/^Device (\S+) (.*)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ mac: m[1], name: m[2] }))

export async function pairedDevices(): Promise<BtDevice[]> {
  const list = parseDevices(await run(BTCTL, ['devices', 'Paired']).catch(() => ''))
  return Promise.all(list.map((d) => info(d.mac)))
}

// Включение/выключение. Выключение отключает подключённые устройства.
export async function setPower(on: boolean) {
  await sudo([BTCTL, 'power', on ? 'on' : 'off'], { timeoutMs: 20_000 })
}

let scanning = false
export const isScanning = () => scanning

// Сканирование ровно 20 секунд (bluetoothctl --timeout 20 scan on). Строки [NEW] — найденные, [CHG] RSSI — уровень сигнала.
export async function scan20s(): Promise<BtDevice[]> {
  if (scanning) throw new Error('сканирование уже идёт')
  scanning = true
  try {
    const out = clean(await sudo([BTCTL, '--timeout', '20', 'scan', 'on'], { timeoutMs: 60_000 }))
    const found = new Map<string, { name: string; rssi: number | null }>()
    for (const line of out.split('\n')) {
      const n = line.match(/\[NEW\] Device (\S+) (.*)$/)
      if (n) found.set(n[1], { name: n[2].trim(), rssi: found.get(n[1])?.rssi ?? null })
      const r = line.match(/\[CHG\] Device (\S+) RSSI: (-?\d+)/)
      if (r) found.set(r[1], { name: found.get(r[1])?.name ?? r[1], rssi: Number(r[2]) })
    }
    return [...found.entries()]
      .map(([mac, v]) => ({ mac, name: v.name && v.name !== mac.replace(/:/g, '-') ? v.name : 'без имени', rssi: v.rssi, icon: null, paired: false, trusted: false, blocked: false, connected: false, battery: null }))
      .sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999))
  } finally {
    scanning = false
  }
}
