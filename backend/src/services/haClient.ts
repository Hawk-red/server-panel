import http from 'node:http'
import net from 'node:net'
import WebSocket from 'ws'
import { errText } from '../mask.js'
import { guardedLookup, isPrivateIp, NOT_LOCAL, urlHost, parseUrl, type ICON_IDS } from './smarthomeCore.js'

// Home Assistant: реестры устройств/областей/сущностей (WebSocket, config/*/list) и состояния (REST /api/states) — только чтение.
// Единственная запись — toggleEntity: turn_on/turn_off для сущностей switch и light (белый список, см. smarthomeControl.ts). Из реестров берутся только нужные поля: идентификаторы, адреса, аккаунты и ключи отбрасываются.

export type HaStatus = 'ok' | 'pending' | 'no-token' | 'unavailable' | 'unauthorized' | 'error'
export class HaError extends Error {
  constructor(
    public status: Exclude<HaStatus, 'ok' | 'pending'>,
    message: string
  ) {
    super(message)
  }
}

export type HaRaw = { devices: unknown[]; areas: unknown[]; entities: unknown[]; states: unknown[] }
export type HaTransport = (baseUrl: string, token: string) => Promise<HaRaw>

// ---------- разбор (чистые функции, покрыты тестами) ----------
// Служебные интеграции и «сенсоры самого HA»: на странице не нужны
export const IGNORED_INTEGRATIONS = new Set([
  'sun', 'backup', 'google_translate', 'radio_browser', 'shopping_list', 'hacs', 'tts', 'stt', 'bluetooth', 'homeassistant', 'go2rtc', 'analytics',
  'person', 'zone', 'hassio', 'cloud', 'assist_pipeline', 'conversation', 'wake_word', 'mobile_app', 'updater', 'met', 'forecast_solar', 'history_stats',
])

export type Tone = 'on' | 'off' | 'neutral' | 'unavailable'
export type HaExtra = { label: string; value: string; unit: string | null }
export type HaSummary = { text: string; tone: Tone; extras: HaExtra[] }
export type ControlState = 'on' | 'off' | 'unavailable'
export type HaControl = { entityId: string; name: string; state: ControlState }
export const CONTROL_DOMAINS = ['switch', 'light'] as const
export const SCENE_DOMAIN = 'scene' // только scene.turn_on
export type HaDevice = {
  id: string
  name: string
  manufacturer: string | null
  model: string | null
  integration: string
  area: string | null
  available: boolean
  summary: HaSummary
  controls: HaControl[]
  icon: (typeof ICON_IDS)[number]
}

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {})
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

const CLASS_LABEL: Record<string, string> = {
  temperature: 'Температура', humidity: 'Влажность', battery: 'Батарея', power: 'Мощность', energy: 'Энергия', voltage: 'Напряжение', current: 'Ток',
  illuminance: 'Освещённость', pressure: 'Давление', signal_strength: 'Сигнал', motion: 'Движение', door: 'Дверь', window: 'Окно', occupancy: 'Присутствие',
  moisture: 'Влага', smoke: 'Дым', opening: 'Открыто', carbon_dioxide: 'CO₂',
}
const TOGGLE = ['light', 'switch', 'fan', 'input_boolean'] as const
const ICON_BY_DOMAIN: Record<string, HaDevice['icon']> = { light: 'lamp', switch: 'socket', fan: 'ac', climate: 'ac', lock: 'lock', camera: 'camera', media_player: 'speaker', cover: 'other', sensor: 'sensor', binary_sensor: 'sensor' }
const DOMAIN_PRIORITY = ['light', 'switch', 'fan', 'climate', 'lock', 'camera', 'media_player', 'cover', 'sensor', 'binary_sensor']

export type HaScene = { entityId: string; name: string; available: boolean }

// Сцены (scene.*) из состояний; отключённые и скрытые в реестре не берутся
export function buildScenes(raw: HaRaw): HaScene[] {
  const off = new Set<string>()
  for (const e of raw.entities) {
    const r = rec(e)
    const id = str(r.entity_id)
    if (id && (r.disabled_by || r.hidden_by)) off.add(id)
  }
  const out: HaScene[] = []
  for (const s of raw.states) {
    const r = rec(s)
    const id = str(r.entity_id)
    if (!id || !id.startsWith('scene.') || off.has(id)) continue
    out.push({ entityId: id, name: (str(rec(r.attributes).friendly_name) ?? id).slice(0, 80), available: r.state !== 'unavailable' })
  }
  return out
}

const num = (s: string) => s.replace('.', ',')
const domainOf = (entityId: string) => entityId.split('.')[0]

type Ent = { entityId: string; platform: string; state: string; attrs: Rec; name: string }

export function buildDevices(raw: HaRaw): HaDevice[] {
  const areas = new Map<string, string>()
  for (const a of raw.areas) {
    const r = rec(a)
    const id = str(r.area_id)
    const name = str(r.name)
    if (id && name) areas.set(id, name)
  }
  const states = new Map<string, { state: string; attrs: Rec }>()
  for (const s of raw.states) {
    const r = rec(s)
    const id = str(r.entity_id)
    if (id) states.set(id, { state: typeof r.state === 'string' ? r.state : 'unknown', attrs: rec(r.attributes) })
  }
  // Видимые сущности по устройствам: не отключённые, не скрытые, с состоянием
  const byDevice = new Map<string, Ent[]>()
  const entityAreas = new Map<string, string[]>()
  for (const e of raw.entities) {
    const r = rec(e)
    const entityId = str(r.entity_id)
    const deviceId = str(r.device_id)
    if (!entityId || !deviceId || r.disabled_by || r.hidden_by) continue
    const category = str(r.entity_category)
    if (category === 'config') continue
    const st = states.get(entityId)
    if (!st) continue
    const platform = str(r.platform) ?? ''
    const list = byDevice.get(deviceId) ?? []
    list.push({ entityId, platform, state: st.state, attrs: st.attrs, name: str(st.attrs.friendly_name) ?? entityId })
    byDevice.set(deviceId, list)
    const area = str(r.area_id)
    if (area) entityAreas.set(deviceId, [...(entityAreas.get(deviceId) ?? []), area])
    if (category === 'diagnostic') list[list.length - 1].attrs = { ...st.attrs, __diagnostic: true }
  }

  const out: HaDevice[] = []
  for (const d of raw.devices) {
    const r = rec(d)
    const id = str(r.id)
    if (!id || r.disabled_by || str(r.entry_type) === 'service') continue
    const ents = byDevice.get(id)
    if (!ents?.length) continue
    // Интеграция устройства — самая частая платформа его сущностей
    const counts = new Map<string, number>()
    for (const e of ents) counts.set(e.platform, (counts.get(e.platform) ?? 0) + 1)
    const integration = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] || 'other'
    if (IGNORED_INTEGRATIONS.has(integration) || ents.every((e) => IGNORED_INTEGRATIONS.has(e.platform))) continue

    const name = str(r.name_by_user) ?? str(r.name) ?? id
    const areaId = str(r.area_id) ?? entityAreas.get(id)?.[0] ?? null
    const summary = summarize(ents, name)
    const primary = DOMAIN_PRIORITY.find((dom) => ents.some((e) => domainOf(e.entityId) === dom))
    out.push({
      id,
      name,
      manufacturer: str(r.manufacturer),
      model: str(r.model),
      integration,
      area: areaId ? (areas.get(areaId) ?? null) : null,
      available: summary.tone !== 'unavailable',
      summary,
      controls: controlsOf(ents, name),
      icon: (primary && ICON_BY_DOMAIN[primary]) || 'other',
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

export const controlState = (s: string): ControlState => (s === 'on' || s === 'off' ? s : 'unavailable')

// Управляемые сущности устройства: только switch и light (белый список); недоступные тоже показываются, но с состоянием unavailable
function controlsOf(ents: Ent[], deviceName: string): HaControl[] {
  return ents
    .filter((e) => (CONTROL_DOMAINS as readonly string[]).includes(domainOf(e.entityId)))
    .map((e) => {
      const n = e.name.startsWith(deviceName) ? e.name.slice(deviceName.length).trim() : e.name
      return { entityId: e.entityId, name: (n || e.name).slice(0, 60), state: controlState(e.state) }
    })
    .sort((a, b) => a.entityId.localeCompare(b.entityId))
}

function summarize(ents: Ent[], deviceName: string): HaSummary {
  const live = ents.filter((e) => e.state !== 'unavailable')
  if (live.length === 0) return { text: 'недоступно', tone: 'unavailable', extras: [] }

  // Короткая подпись показателя: класс датчика или имя сущности без имени устройства
  const label = (e: Ent) => {
    const cls = str(e.attrs.device_class)
    if (cls && CLASS_LABEL[cls]) return CLASS_LABEL[cls]
    const n = e.name.startsWith(deviceName) ? e.name.slice(deviceName.length).trim() : e.name
    return n || e.name
  }
  const extras: HaExtra[] = live
    .filter((e) => (domainOf(e.entityId) === 'sensor' || domainOf(e.entityId) === 'binary_sensor') && e.state !== 'unknown' && !e.attrs.__diagnostic)
    .slice(0, 3)
    .map((e) => (domainOf(e.entityId) === 'binary_sensor' ? { label: label(e), value: e.state === 'on' ? 'да' : 'нет', unit: null } : { label: label(e), value: num(e.state), unit: str(e.attrs.unit_of_measurement) }))

  const toggles = live.filter((e) => (TOGGLE as readonly string[]).includes(domainOf(e.entityId)) && (e.state === 'on' || e.state === 'off'))
  if (toggles.length > 0) {
    const on = toggles.filter((e) => e.state === 'on').length
    const text = toggles.length === 1 ? (on ? 'включено' : 'выключено') : `включено ${on} из ${toggles.length}`
    return { text, tone: on > 0 ? 'on' : 'off', extras }
  }
  const climate = live.find((e) => domainOf(e.entityId) === 'climate')
  if (climate) {
    const t = climate.attrs.current_temperature
    return { text: typeof t === 'number' ? `${num(String(t))} °C` : 'доступно', tone: climate.state === 'off' ? 'off' : 'neutral', extras }
  }
  const lock = live.find((e) => domainOf(e.entityId) === 'lock')
  if (lock) return { text: lock.state === 'locked' ? 'закрыто' : lock.state === 'unlocked' ? 'открыто' : 'доступно', tone: 'neutral', extras }
  if (extras.length > 0) return { text: extras[0].unit ? `${extras[0].value} ${extras[0].unit}` : extras[0].value, tone: 'neutral', extras: extras.slice(1) }
  return { text: 'доступно', tone: 'neutral', extras: [] }
}

// ---------- транспорт (только локальная сеть, только чтение) ----------
const TIMEOUT_MS = 8000

function parseBase(baseUrl: string): URL {
  const u = parseUrl(baseUrl)
  if (!u) throw new HaError('error', 'HA_URL: нужен адрес вида http://127.0.0.1:8123')
  const host = urlHost(u)
  if (net.isIP(host) && !isPrivateIp(host)) throw new HaError('error', `HA_URL: ${NOT_LOCAL}`)
  return u
}

const kindOf = (e: unknown): HaError => {
  if (e instanceof HaError) return e
  const code = (e as NodeJS.ErrnoException)?.code
  const msg = errText(e)
  if (msg.includes('локальной сети')) return new HaError('error', 'HA_URL: адрес не из локальной сети')
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENOTFOUND' || code === 'ECONNRESET' || /timeout|таймаут/i.test(msg)) return new HaError('unavailable', 'Home Assistant недоступен')
  return new HaError('error', msg.split('\n')[0] || 'ошибка Home Assistant')
}

function getJson(u: URL, path: string, token: string, opts: { method?: 'GET' | 'POST'; body?: unknown; timeout?: number } = {}): Promise<unknown> {
  const payload = opts.body === undefined ? null : JSON.stringify(opts.body)
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    if (payload !== null) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = Buffer.byteLength(payload)
    }
    const req = http.request(
      { protocol: u.protocol, hostname: urlHost(u), port: u.port || 80, path, method: opts.method ?? 'GET', timeout: opts.timeout ?? TIMEOUT_MS, lookup: guardedLookup(), headers },
      (res) => {
        if (res.statusCode === 401) {
          res.resume()
          return reject(new HaError('unauthorized', 'Home Assistant отклонил токен (401): создайте новый токен доступа'))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new HaError('error', `Home Assistant ответил ${res.statusCode}`))
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > 16 * 1024 * 1024) return req.destroy(new Error('ответ слишком большой'))
          chunks.push(c)
        })
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch {
            reject(new HaError('error', 'Home Assistant вернул не JSON'))
          }
        })
      }
    )
    req.once('timeout', () => req.destroy(new Error('таймаут')))
    req.once('error', reject)
    req.end(payload)
  })
}

// Три команды чтения по одному WebSocket-соединению
const COMMANDS = ['config/device_registry/list', 'config/area_registry/list', 'config/entity_registry/list'] as const

function wsRead(u: URL, token: string): Promise<unknown[][]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}/api/websocket`, { lookup: guardedLookup(), handshakeTimeout: TIMEOUT_MS, maxPayload: 32 * 1024 * 1024 })
    const results: unknown[][] = []
    let done = false
    const finish = (err?: unknown) => {
      if (done) return
      done = true
      clearTimeout(timer)
      ws.removeAllListeners()
      ws.on('error', () => undefined)
      try {
        ws.close()
      } catch {
        /* уже закрыт */
      }
      if (err) reject(err)
      else resolve(results)
    }
    const timer = setTimeout(() => finish(new Error('таймаут')), TIMEOUT_MS * 2)
    ws.on('error', finish)
    ws.on('close', () => finish(new Error('соединение закрыто')))
    ws.on('message', (data) => {
      let m: Rec
      try {
        m = JSON.parse(data.toString())
      } catch {
        return
      }
      if (m.type === 'auth_required') return ws.send(JSON.stringify({ type: 'auth', access_token: token }))
      if (m.type === 'auth_invalid') return finish(new HaError('unauthorized', 'Home Assistant отклонил токен: создайте новый токен доступа'))
      if (m.type === 'auth_ok') return COMMANDS.forEach((type, i) => ws.send(JSON.stringify({ id: i + 1, type })))
      if (m.type === 'result' && typeof m.id === 'number') {
        if (m.success !== true) return finish(new HaError('error', `Home Assistant не выполнил ${COMMANDS[m.id - 1] ?? 'запрос'} (нужен токен администратора)`))
        results[m.id - 1] = Array.isArray(m.result) ? m.result : []
        if (results.filter(Boolean).length === COMMANDS.length) finish()
      }
    })
  })
}

export const liveTransport: HaTransport = async (baseUrl, token) => {
  try {
    const u = parseBase(baseUrl)
    const [[devices, areas, entities], states] = await Promise.all([wsRead(u, token), getJson(u, '/api/states', token)])
    return { devices, areas, entities, states: Array.isArray(states) ? states : [] }
  } catch (e) {
    throw kindOf(e)
  }
}

// Устройства и сцены за одно чтение
export async function readHome(opts: { url: string; token: string; transport?: HaTransport }): Promise<{ devices: HaDevice[]; scenes: HaScene[] }> {
  if (!opts.token) throw new HaError('no-token', 'Токен Home Assistant не задан')
  const raw = await (opts.transport ?? liveTransport)(opts.url, opts.token)
  return { devices: buildDevices(raw), scenes: buildScenes(raw) }
}

export async function readDevices(opts: { url: string; token: string; transport?: HaTransport }): Promise<HaDevice[]> {
  if (!opts.token) throw new HaError('no-token', 'Токен Home Assistant не задан')
  return buildDevices(await (opts.transport ?? liveTransport)(opts.url, opts.token))
}

// ---------- управление (единственная запись в HA) ----------
export type HaControlApi = {
  call: (baseUrl: string, token: string, domain: string, action: 'on' | 'off', entityId: string) => Promise<void>
  state: (baseUrl: string, token: string, entityId: string) => Promise<string>
}
const CONTROL_TIMEOUT_MS = 5000

export const liveControlApi: HaControlApi = {
  async call(baseUrl, token, domain, action, entityId) {
    // Разрешены только пары: switch/light — on/off, scene — on (у сцены нет «выключить»)
    const allowed = domain === SCENE_DOMAIN ? action === 'on' : (CONTROL_DOMAINS as readonly string[]).includes(domain)
    if (!allowed) throw new HaError('error', 'Это действие нельзя выполнить из панели')
    try {
      await getJson(parseBase(baseUrl), `/api/services/${domain}/turn_${action}`, token, { method: 'POST', body: { entity_id: entityId }, timeout: CONTROL_TIMEOUT_MS })
    } catch (e) {
      throw kindOf(e)
    }
  },
  async state(baseUrl, token, entityId) {
    try {
      const r = rec(await getJson(parseBase(baseUrl), `/api/states/${entityId}`, token, { timeout: CONTROL_TIMEOUT_MS }))
      return typeof r.state === 'string' ? r.state : 'unavailable'
    } catch (e) {
      throw kindOf(e)
    }
  },
}

// Медленные устройства (Sonoff LAN) подтверждают не сразу: до 2 повторных чтений состояния с паузой ~700 мс
export const CONFIRM_RETRIES = 2
export const CONFIRM_PAUSE_MS = 700
export type ToggleResult = { state: ControlState; confirmed: boolean }

// turn_on/turn_off и чтение состояния, пока оно не станет ожидаемым (или не кончатся попытки). Домен проверяется ещё раз здесь, независимо от маршрута.
export async function toggleEntity(opts: {
  url: string
  token: string
  entityId: string
  action: 'on' | 'off'
  api?: HaControlApi
  sleep?: (ms: number) => Promise<void>
}): Promise<ToggleResult> {
  if (!opts.token) throw new HaError('no-token', 'Токен Home Assistant не задан')
  const domain = domainOf(opts.entityId)
  if (!(CONTROL_DOMAINS as readonly string[]).includes(domain) || !/^[a-z_]+\.[a-z0-9_]+$/.test(opts.entityId)) throw new HaError('error', 'Это устройство нельзя включать и выключать из панели')
  const api = opts.api ?? liveControlApi
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  await api.call(opts.url, opts.token, domain, opts.action, opts.entityId)
  let state = controlState(await api.state(opts.url, opts.token, opts.entityId))
  for (let i = 0; i < CONFIRM_RETRIES && state !== opts.action; i++) {
    await sleep(CONFIRM_PAUSE_MS)
    state = controlState(await api.state(opts.url, opts.token, opts.entityId))
  }
  return { state, confirmed: state === opts.action }
}

// Только чтение: сцены (scene.*) — entity_id и friendly_name. Используется скриптом scripts/list-scenes.ts
export async function readScenes(opts: { url: string; token: string }): Promise<{ entityId: string; name: string; state: string }[]> {
  if (!opts.token) throw new HaError('no-token', 'Токен Home Assistant не задан')
  try {
    const list = await getJson(parseBase(opts.url), '/api/states', opts.token)
    return (Array.isArray(list) ? list : [])
      .map(rec)
      .filter((r) => typeof r.entity_id === 'string' && r.entity_id.startsWith('scene.'))
      .map((r) => ({ entityId: r.entity_id as string, name: str(rec(r.attributes).friendly_name) ?? (r.entity_id as string), state: typeof r.state === 'string' ? r.state : 'unknown' }))
  } catch (e) {
    throw kindOf(e)
  }
}

// Запуск сцены: scene.turn_on. Домен проверяется здесь независимо от маршрута.
export async function activateScene(opts: { url: string; token: string; entityId: string; api?: HaControlApi }): Promise<void> {
  if (!opts.token) throw new HaError('no-token', 'Токен Home Assistant не задан')
  if (!/^scene\.[a-z0-9_]+$/.test(opts.entityId)) throw new HaError('error', 'Это не сцена')
  await (opts.api ?? liveControlApi).call(opts.url, opts.token, SCENE_DOMAIN, 'on', opts.entityId)
}
