import { run, sudo } from '../exec.js'

// Wi-Fi через NetworkManager. Чтение — от пользователя панели; изменения — только через sudo-утилиту
// /usr/local/sbin/server-panel-wifi (deploy/server-panel-wifi), которая работает только с wlp2s0.
const IFACE = 'wlp2s0'
const NMCLI = '/usr/bin/nmcli'
const UTIL = '/usr/local/sbin/server-panel-wifi'

export type WifiNetwork = {
  ssid: string
  signal: number // 0–100, лучший из BSSID с этим SSID
  bands: ('2.4' | '5')[] // у сети с двумя BSSID может быть оба диапазона
  channel: number | null
  secured: boolean
  saved: boolean
  savedUuid: string | null
  connected: boolean
}

// nmcli -t экранирует двоеточие как \: — разбираем поля по неэкранированным двоеточиям
function splitTerse(line: string): string[] {
  const SEP = '\u0000'
  return line.replace(/\\:/g, SEP).split(':').map((f) => f.split(SEP).join(':'))
}

const band = (freqMhz: number | null): '2.4' | '5' | null => (freqMhz == null ? null : freqMhz < 3000 ? '2.4' : '5')

export async function radioOn(): Promise<boolean> {
  return (await run(NMCLI, ['-t', 'radio', 'wifi']).catch(() => '')).trim() === 'enabled'
}

// Сохранённые Wi-Fi-профили: uuid и SSID (для сопоставления со списком сетей)
async function savedWifi(): Promise<{ uuid: string; ssid: string; name: string }[]> {
  const rows = (await run(NMCLI, ['-t', '-f', 'NAME,UUID,TYPE', 'connection', 'show']).catch(() => ''))
    .split('\n')
    .map(splitTerse)
    .filter((f) => f[2] === '802-11-wireless')
  const out: { uuid: string; ssid: string; name: string }[] = []
  for (const r of rows) {
    const ssid = (await run(NMCLI, ['-g', '802-11-wireless.ssid', 'connection', 'show', 'uuid', r[1]]).catch(() => '')).trim()
    out.push({ uuid: r[1], ssid, name: r[0] })
  }
  return out
}

export async function wifiStatus() {
  const [radio, devLines, active, saved, ipJson, routeJson, scanLines] = await Promise.all([
    radioOn(),
    run(NMCLI, ['-t', '-f', 'DEVICE,STATE,CONNECTION', 'device', 'status']).catch(() => ''),
    run(NMCLI, ['-t', '-f', 'UUID,DEVICE', 'connection', 'show', '--active']).catch(() => ''),
    savedWifi(),
    run('/usr/sbin/ip', ['-j', '-4', 'addr', 'show', 'dev', IFACE]).catch(() => '[]'),
    run('/usr/sbin/ip', ['-j', 'route', 'show', 'default']).catch(() => '[]'),
    run(NMCLI, ['-t', '-f', 'IN-USE,BSSID,SSID,CHAN,FREQ,SIGNAL,SECURITY', 'device', 'wifi', 'list', 'ifname', IFACE, '--rescan', 'no']).catch(() => ''),
  ])

  const devState = devLines.split('\n').map(splitTerse).find((f) => f[0] === IFACE)?.[1] ?? null
  const activeUuid = active.split('\n').map(splitTerse).find((f) => f[1] === IFACE)?.[0] ?? null
  const savedBySsid = new Map(saved.filter((s) => s.ssid).map((s) => [s.ssid, s]))
  const activeSaved = saved.find((s) => s.uuid === activeUuid) ?? null
  const connectedSsid = activeSaved?.ssid ?? null

  // Сети: дедупликация по SSID (у «My NeT» два BSSID — 2.4 и 5 ГГц): сигнал и канал берём у лучшего BSSID
  const bySsid = new Map<string, WifiNetwork>()
  for (const line of scanLines.split('\n')) {
    if (!line) continue
    const [inUse, , ssid, chan, freq, signal, security] = splitTerse(line)
    if (!ssid) continue // скрытые сети без имени не показываем
    const sig = Number(signal) || 0
    const b = band(Number((freq ?? '').replace(/[^0-9]/g, '')) || null)
    const isConnected = inUse === '*' || ssid === connectedSsid
    const isSecured = Boolean(security && security !== '--')
    const prev = bySsid.get(ssid)
    const best = !prev || sig > prev.signal
    const bands = [...new Set([...(prev?.bands ?? []), ...(b ? [b] : [])])]
    bySsid.set(ssid, {
      ssid,
      signal: best ? sig : prev!.signal,
      bands,
      channel: best ? Number(chan) || null : prev!.channel,
      secured: isSecured || (prev?.secured ?? false),
      saved: savedBySsid.has(ssid),
      savedUuid: savedBySsid.get(ssid)?.uuid ?? null,
      connected: isConnected || (prev?.connected ?? false),
    })
  }
  const networks = [...bySsid.values()].sort((a, b) => Number(b.connected) - Number(a.connected) || b.signal - a.signal)

  const ip = (JSON.parse(ipJson || '[]') as { addr_info?: { local: string; prefixlen: number }[] }[])[0]?.addr_info?.[0] ?? null
  const routes = JSON.parse(routeJson || '[]') as { dev?: string; metric?: number }[]
  const primary = routes.slice().sort((a, b) => (a.metric ?? 0) - (b.metric ?? 0))[0] ?? null

  return {
    radio,
    device: devState,
    connected: devState === 'connected' && Boolean(connectedSsid),
    ssid: connectedSsid,
    savedUuid: activeSaved?.uuid ?? null,
    ip: ip ? `${ip.local}/${ip.prefixlen}` : null,
    // Какой канал сейчас маршрутизирует трафик по умолчанию (кабель должен оставаться primary)
    primaryInterface: primary?.dev ?? null,
    networks,
  }
}

// Внеочередной скан (кнопка «Обновить»). Для пользователя панели полномочий NetworkManager хватает.
export async function rescan() {
  await run(NMCLI, ['device', 'wifi', 'rescan', 'ifname', IFACE], { timeoutMs: 20_000 })
}

export async function setRadio(on: boolean) {
  await sudo([UTIL, 'radio', on ? 'on' : 'off'], { timeoutMs: 30_000 })
}

// Подключение к новой сети: пароль уходит в stdin утилиты, не в командную строку
export async function connectNew(ssid: string, psk: string) {
  const { execFile } = await import('node:child_process')
  return new Promise<string>((resolve, reject) => {
    const child = execFile('/usr/bin/sudo', ['-n', UTIL, 'connect-new'], { timeout: 90_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || 'не удалось подключиться'))
      else resolve(stdout.trim())
    })
    child.stdin?.end(`${ssid}\n${psk}\n`)
  })
}

export async function connectSaved(uuid: string) {
  await sudo([UTIL, 'connect-saved', uuid], { timeoutMs: 90_000 })
}

export async function forget(uuid: string) {
  await sudo([UTIL, 'forget', uuid], { timeoutMs: 30_000 })
}

export async function disconnect() {
  await sudo([UTIL, 'disconnect'], { timeoutMs: 30_000 })
}

export { IFACE }
