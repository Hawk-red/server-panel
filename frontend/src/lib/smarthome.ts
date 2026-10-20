// Страница «Умный дом»: типы, значки, комнаты и проверка формы. Без React, чтобы покрыть тестами.
// Порядок карточек хранит общий механизм страниц (SortableBlocks): настройка панели layout.smarthome на сервере.

export const SMARTHOME_LAYOUT_PAGE = 'smarthome'
export const SMARTHOME_PATH = '/smarthome'
export const MAX_DEVICES = 60 // как на сервере: порядок хранится списком до 60 id

export const KINDS = [
  { id: 'link', label: 'Ссылка', hint: 'Веб-интерфейс устройства; доступность проверяется по порту' },
  { id: 'http', label: 'HTTP-проверка', hint: 'Проверка ответа веб-страницы устройства' },
  { id: 'tcp', label: 'Проверка порта', hint: 'Открыт ли TCP-порт' },
  { id: 'ping', label: 'Только доступность', hint: 'Ответ на ping' },
  { id: 'homeassistant', label: 'Home Assistant', hint: 'Заготовка: проверяется адрес, без интеграции' },
] as const
export type Kind = (typeof KINDS)[number]['id']

export const ICONS = [
  { id: 'lamp', label: 'Лампа' },
  { id: 'socket', label: 'Розетка' },
  { id: 'sensor', label: 'Датчик' },
  { id: 'camera', label: 'Камера' },
  { id: 'lock', label: 'Замок' },
  { id: 'ac', label: 'Кондиционер' },
  { id: 'tv', label: 'Телевизор' },
  { id: 'router', label: 'Роутер' },
  { id: 'speaker', label: 'Колонка' },
  { id: 'other', label: 'Другое' },
] as const
export type IconId = (typeof ICONS)[number]['id']

export const DEFAULT_ROOMS = ['Гостиная', 'Кухня', 'Спальня', 'Прихожая']

export type DeviceStatus = { state: 'online' | 'offline' | 'unknown' | 'disabled' | 'checking'; checkedAt: number | null; latencyMs: number | null; detail: string | null }
export type HaSummary = { text: string; tone: 'on' | 'off' | 'neutral' | 'unavailable'; extras: { label: string; value: string; unit: string | null }[] }
export type ControlState = 'on' | 'off' | 'unavailable'
export type HaControl = { entityId: string; name: string; state: ControlState }
export type HaInfo = { manufacturer: string | null; model: string | null; integration: string; area: string | null; available: boolean; summary: HaSummary; controls?: HaControl[] }
export type SmartDevice = {
  id: number
  name: string
  kind: Kind
  room: string | null
  icon: IconId
  host: string | null
  port: number | null
  url: string | null
  notes: string | null
  enabled: boolean
  status: DeviceStatus
  source: 'manual' | 'homeassistant'
  haDeviceId: string | null
  haMissing: boolean
  ha: HaInfo | null
  groupKey: string | null
  groupId: string
  hidden: boolean
}

export type Accent = 'info' | 'ok' | 'warn' | 'brand' | 'indigo' | 'volume'
export type GroupIcon = 'home' | 'plug' | 'cloud' | 'folder' | 'box'
export type Group = { id: string; name: string; accent: Accent; icon: GroupIcon; custom: boolean }
export type HaConnection = { configured: boolean; status: 'ok' | 'pending' | 'no-token' | 'unavailable' | 'unauthorized' | 'error'; message: string | null; syncedAt: number | null }
export const SCENE_COLORS = ['green', 'red', 'magenta', 'blue', 'brown', 'emerald', 'violet', 'orange', 'slate', 'cyan'] as const
export const SCENE_ICONS = ['tv', 'power', 'clapperboard', 'flame', 'radio', 'laptop', 'gamepad', 'smartphone', 'lightbulb', 'volume', 'monitor', 'sparkles'] as const
export type SceneColor = (typeof SCENE_COLORS)[number]
export type SceneIcon = (typeof SCENE_ICONS)[number]
export type Scene = { id: string; entityId: string; name: string; haName: string; nameCustom: boolean; color: SceneColor; icon: SceneIcon; hidden: boolean; missing: boolean; available: boolean }
export type SmartHomeData = { devices: SmartDevice[]; hidden: SmartDevice[]; groups: Group[]; scenes: Scene[]; ha: HaConnection; now: number }

// Порядок блоков хранится под ключом страницы, порядок карточек внутри блока — под своим ключом (на сервере: layout.<ключ>, до 30 символов)
export const groupBlockId = (groupId: string) => `g-${groupId}`
export const groupLayoutPage = (groupId: string) => `${SMARTHOME_LAYOUT_PAGE}-${groupId}`.slice(0, 30)

export function devicesByGroup(devices: SmartDevice[], groups: Pick<Group, 'id'>[]): Map<string, SmartDevice[]> {
  const m = new Map<string, SmartDevice[]>(groups.map((g) => [g.id, []]))
  for (const d of devices) m.get(d.groupId)?.push(d)
  return m
}

// «N устройств · M в сети» и, если есть, «K включено»
export function groupSummary(devices: SmartDevice[]): string {
  const online = devices.filter((d) => d.status.state === 'online').length
  const on = devices.filter((d) => d.ha?.summary.tone === 'on').length
  return `${devices.length} ${plural(devices.length, 'устройство', 'устройства', 'устройств')} · ${online} в сети${on > 0 ? ` · ${on} включено` : ''}`
}

export const HA_STATUS_TEXT: Record<Exclude<HaConnection['status'], 'ok' | 'pending' | 'no-token'>, string> = {
  unavailable: 'Home Assistant недоступен',
  unauthorized: 'Home Assistant отклонил токен (401)',
  error: 'Ошибка Home Assistant',
}

export const deviceBlockId = (id: number) => `dev-${id}` // допустимо серверу: ^[a-z0-9-]{1,40}$

export const ALL_ROOMS = 'all'
export const NO_ROOM = 'none'

// Комнаты из введённых устройств (по алфавиту) + «без комнаты», если такие есть
export function roomsOf(devices: Pick<SmartDevice, 'room'>[]): { rooms: string[]; hasNoRoom: boolean } {
  const set = new Set<string>()
  let hasNoRoom = false
  for (const d of devices) {
    if (d.room) set.add(d.room)
    else hasNoRoom = true
  }
  return { rooms: [...set].sort((a, b) => a.localeCompare(b, 'ru')), hasNoRoom }
}

export function filterByRoom<T extends Pick<SmartDevice, 'room'>>(devices: T[], room: string): T[] {
  if (room === ALL_ROOMS) return devices
  if (room === NO_ROOM) return devices.filter((d) => !d.room)
  return devices.filter((d) => d.room === room)
}

export const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10
  const m100 = n % 100
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many
}

export function summaryText(devices: Pick<SmartDevice, 'status'>[]): string {
  const online = devices.filter((d) => d.status.state === 'online').length
  return `${devices.length} ${plural(devices.length, 'устройство', 'устройства', 'устройств')} · ${online} в сети`
}

// Адрес для кнопки «Открыть»: только http/https; для HTTP-проверки по IP — адрес устройства
export function openUrl(d: Pick<SmartDevice, 'kind' | 'url' | 'host' | 'port'> & { source?: string }): string | null {
  if (d.source === 'homeassistant') return null // у устройств HA своя кнопка «Открыть в HA»
  if (d.url && /^https?:\/\//i.test(d.url)) return d.url
  if (d.kind === 'http' && d.host) return `http://${d.host.includes(':') ? `[${d.host}]` : d.host}${d.port && d.port !== 80 ? `:${d.port}` : ''}/`
  if (d.kind === 'homeassistant' && d.host) return `http://${d.host}:${d.port ?? 8123}/`
  return null
}

export function statusLabel(s: DeviceStatus, source: SmartDevice['source'] = 'manual'): string {
  if (source === 'homeassistant') return s.state === 'online' ? 'доступно' : s.state === 'offline' ? 'недоступно' : (s.detail ?? 'нет данных')
  switch (s.state) {
    case 'online': return s.latencyMs !== null ? `в сети · ${s.latencyMs} мс` : 'в сети'
    case 'offline': return 'не в сети'
    case 'checking': return 'проверяю…'
    case 'disabled': return 'не проверяется'
    default: return 'нечего проверять'
  }
}

// ---------- форма ----------
export type DeviceForm = { name: string; kind: Kind; room: string; icon: IconId; host: string; port: string; url: string; notes: string; enabled: boolean }
export const emptyForm = (): DeviceForm => ({ name: '', kind: 'ping', room: '', icon: 'other', host: '', port: '', url: '', notes: '', enabled: true })

const HOSTNAME_RE = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/
const IPV6_RE = /^[0-9a-fA-F:]+$/
const validHost = (h: string) => HOSTNAME_RE.test(h) || (h.includes(':') && IPV6_RE.test(h))

function validUrl(raw: string): boolean {
  if (raw.length > 300) return false
  try {
    const u = new URL(raw)
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password
  } catch {
    return false
  }
}

// Те же правила, что на сервере (там они проверяются ещё раз): ошибки по полям
export function validateForm(f: DeviceForm): Partial<Record<keyof DeviceForm, string>> {
  const e: Partial<Record<keyof DeviceForm, string>> = {}
  const name = f.name.trim()
  if (name.length < 1 || name.length > 60) e.name = 'Название: от 1 до 60 символов'
  if (f.room.trim().length > 40) e.room = 'Комната: не длиннее 40 символов'
  if (f.notes.trim().length > 300) e.notes = 'Заметка: не длиннее 300 символов'
  const host = f.host.trim()
  const url = f.url.trim()
  if (host && !validHost(host)) e.host = 'Адрес: только IP или имя хоста, без пробелов и спецсимволов'
  if (f.port.trim() !== '') {
    const p = Number(f.port)
    if (!Number.isInteger(p) || p < 1 || p > 65535) e.port = 'Порт: число от 1 до 65535'
  }
  if (url && !validUrl(url)) e.url = 'Ссылка: только http:// или https://, без логина и пароля'
  if (!e.url && !e.host && !e.port) {
    if (f.kind === 'link' && !url) e.url = 'Для ссылки укажите адрес http:// или https://'
    if (f.kind === 'http' && !url && !host) e.host = 'Укажите ссылку или адрес устройства'
    if (f.kind === 'tcp' && !host) e.host = 'Для проверки порта нужны адрес и порт'
    if (f.kind === 'tcp' && host && f.port.trim() === '') e.port = 'Для проверки порта нужны адрес и порт'
    if (f.kind === 'ping' && !host) e.host = 'Укажите адрес устройства'
  }
  return e
}

// Какие поля адреса показывать для типа
export function addressFields(kind: Kind): { url: boolean; host: boolean; port: boolean } {
  switch (kind) {
    case 'link': return { url: true, host: false, port: false }
    case 'http': return { url: true, host: true, port: true }
    case 'tcp': return { url: false, host: true, port: true }
    case 'ping': return { url: false, host: true, port: false }
    case 'homeassistant': return { url: true, host: true, port: true }
  }
}

export function toPayload(f: DeviceForm) {
  const fields = addressFields(f.kind)
  return {
    name: f.name.trim(),
    kind: f.kind,
    room: f.room.trim(),
    icon: f.icon,
    host: fields.host ? f.host.trim() : '',
    port: fields.port && f.port.trim() !== '' ? Number(f.port) : null,
    url: fields.url ? f.url.trim() : '',
    notes: f.notes.trim(),
    enabled: f.enabled,
  }
}

export const toForm = (d: SmartDevice): DeviceForm => ({
  name: d.name, kind: d.kind, room: d.room ?? '', icon: d.icon, host: d.host ?? '', port: d.port === null ? '' : String(d.port), url: d.url ?? '', notes: d.notes ?? '', enabled: d.enabled,
})

// Примеры для пустого состояния: подставляются в форму
export const EXAMPLES: { title: string; hint: string; form: Partial<DeviceForm> }[] = [
  { title: 'Лампа Wi-Fi', hint: 'проверка доступности по адресу', form: { name: 'Лампа', kind: 'ping', icon: 'lamp' } },
  { title: 'Розетка', hint: 'Sonoff и другие: ping или порт', form: { name: 'Розетка', kind: 'ping', icon: 'socket' } },
  { title: 'Камера', hint: 'ссылка на веб-интерфейс', form: { name: 'Камера', kind: 'link', icon: 'camera', url: 'http://' } },
]

// ---------- переключатели (switch/light) ----------
// Подставляет состояние сущности в данные страницы и пересчитывает итог «включено N из M»
export function withControlState(data: SmartHomeData, entityId: string, state: ControlState): SmartHomeData {
  const patch = (d: SmartDevice): SmartDevice => {
    const controls = d.ha?.controls
    if (!d.ha || !controls?.some((c) => c.entityId === entityId)) return d
    const next = controls.map((c) => (c.entityId === entityId ? { ...c, state } : c))
    const usable = next.filter((c) => c.state !== 'unavailable')
    const on = usable.filter((c) => c.state === 'on').length
    let summary = d.ha.summary
    if (usable.length > 0 && /^(включено|выключено)/.test(summary.text))
      summary = { ...summary, text: usable.length === 1 ? (on ? 'включено' : 'выключено') : `включено ${on} из ${usable.length}`, tone: on > 0 ? 'on' : 'off' }
    return { ...d, ha: { ...d.ha, controls: next, summary } }
  }
  return { ...data, devices: data.devices.map(patch) }
}

export type ToggleDeps = {
  get: () => SmartHomeData | undefined
  set: (d: SmartHomeData) => void
  post: (entityId: string, action: 'on' | 'off') => Promise<{ state: ControlState }>
}
// Оптимистичное переключение: сразу показывает новое состояние, отправляет команду, по ответу ставит реальное;
// при ошибке возвращает прежнее состояние и пробрасывает ошибку (для toast)
export async function performToggle(deps: ToggleDeps, entityId: string, on: boolean): Promise<ControlState> {
  const before = deps.get()
  const prev = before?.devices.flatMap((d) => d.ha?.controls ?? []).find((c) => c.entityId === entityId)?.state
  if (before) deps.set(withControlState(before, entityId, on ? 'on' : 'off'))
  try {
    const { state } = await deps.post(entityId, on ? 'on' : 'off')
    const now = deps.get()
    if (now) deps.set(withControlState(now, entityId, state))
    return state
  } catch (e) {
    const now = deps.get()
    if (now && prev) deps.set(withControlState(now, entityId, prev))
    throw e
  }
}

// ---------- быстрые сцены ----------
export const SCENES_LAYOUT_PAGE = 'smarthome-scenes' // порядок плиток: layout.smarthome-scenes

// Скрытые и пропавшие из HA сцены видны только в режиме изменения (полупрозрачные)
export const visibleScenes = (scenes: Scene[], editing: boolean): Scene[] => scenes.filter((s) => editing || (!s.hidden && !s.missing))
// Сцену можно запускать, если она доступна, не скрыта и не пропала
export const sceneRunnable = (s: Pick<Scene, 'available' | 'hidden' | 'missing'>) => s.available && !s.hidden && !s.missing

// Запуск сцены: результат вместо исключения, чтобы плитка показала галочку или ошибку
export async function runScene(post: (entityId: string) => Promise<unknown>, entityId: string, errText: (e: unknown) => string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await post(entityId)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: errText(e) }
  }
}
