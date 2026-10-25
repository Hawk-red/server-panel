// Универсальный пульт («Медиа» → вкладка «Универсальный»): два столбца крупных плиток — Samsung (телевизор, сцены
// и выключатели) и Marantz (ресивер). Каждый столбец хранится отдельно (universal.remote.tv и universal.remote.receiver) и правится
// независимо. Новых способов управления нет: кнопка ссылается на кнопку уже существующего экранного пульта (её команду
// решают привязки receiver.remote / tv.remote), на сцену панели либо на выключатель «Умного дома» (switch/light из его
// белого списка), а исполняют их прежние маршруты со своими белыми списками, лимитами и журналом.
import { getSetting, setSetting } from '../settings.js'
import { SCENE_COLORS, SCENE_ICONS, type SceneColor, type SceneIcon } from './smarthomeScenes.js'
import * as receiverRemote from './receiverRemote.js'
import * as tvRemote from './tvRemote.js'
import { cachedInputs } from './receiver.js'
import { findControl, findScene, listDevices, listScenes } from './smarthome.js'
import { CONTROL_DOMAINS } from './haClient.js'

/** Старое общее хранилище (один столбец). Остаётся на месте: из него один раз переносятся плитки */
export const SETTING_KEY = 'universal.remote'
export const MIGRATED_KEY = 'universal.remote.migrated'
/** Разовое дополнение: три плитки-выключателя в левый столбец (см. SWITCH_TILES) */
export const SWITCHES_KEY = 'universal.remote.switches-added'
export const MAX_BUTTONS = 48

export const COLUMNS = ['tv', 'receiver'] as const
export type UniColumn = (typeof COLUMNS)[number]
export const COLUMN_KEY: Record<UniColumn, string> = { tv: 'universal.remote.tv', receiver: 'universal.remote.receiver' }
export const COLUMN_TITLE: Record<UniColumn, string> = { tv: 'Samsung', receiver: 'Marantz' }
export const isColumn = (v: unknown): v is UniColumn => typeof v === 'string' && (COLUMNS as readonly string[]).includes(v)

export type UniSource = 'receiver' | 'tv' | 'scene' | 'switch'
export type UniButton = { id: string; source: UniSource; command: string; label: string; icon: SceneIcon; color: SceneColor }
/** Кнопка плюс то, что про неё знает сервер: во что она развернётся и можно ли её нажать */
export type UniButtonView = UniButton & { resolved: string | null; title: string; available: boolean }

const SOURCES: UniSource[] = ['receiver', 'tv', 'scene', 'switch']
const ID_RE = /^[a-z0-9-]{1,40}$/
const SCENE_RE = /^scene\.[a-z0-9_]+$/
const ENTITY_RE = /^[a-z_]+\.[a-z0-9_]+$/

const b = (id: string, source: UniSource, command: string, label: string, icon: SceneIcon, color: SceneColor): UniButton => ({ id, source, command, label, icon, color })

// Левый столбец: только кнопки Samsung — питание, громкость, Mute, источник, каналы, навигация, RETURN/EXIT/MENU/INFO, play/pause
const TV_DEFAULTS: UniButton[] = [
  b('tv-power', 'tv', 'power', 'Телевизор', 'power', 'red'),
  b('tv-source', 'tv', 'source', 'Источник', 'tv', 'cyan'),
  b('tv-vol-up', 'tv', 'vol-up', 'Громче', 'volume', 'green'),
  b('tv-vol-down', 'tv', 'vol-down', 'Тише', 'volume', 'green'),
  b('tv-mute', 'tv', 'mute', 'Без звука', 'volume', 'slate'),
  b('tv-ch-up', 'tv', 'p-up', 'Канал +', 'monitor', 'blue'),
  b('tv-ch-down', 'tv', 'p-down', 'Канал −', 'monitor', 'blue'),
  b('tv-up', 'tv', 'nav-up', '▲', 'monitor', 'slate'),
  b('tv-left', 'tv', 'nav-left', '◀', 'monitor', 'slate'),
  b('tv-enter', 'tv', 'enter', 'OK', 'monitor', 'blue'),
  b('tv-right', 'tv', 'nav-right', '▶', 'monitor', 'slate'),
  b('tv-down', 'tv', 'nav-down', '▼', 'monitor', 'slate'),
  b('tv-return', 'tv', 'return', 'Назад', 'monitor', 'slate'),
  b('tv-exit', 'tv', 'exit', 'Выход', 'monitor', 'slate'),
  b('tv-menu', 'tv', 'menu', 'Меню', 'tv', 'slate'),
  b('tv-info', 'tv', 'info', 'Инфо', 'tv', 'slate'),
  b('tv-play', 'tv', 'play', 'Play', 'monitor', 'emerald'),
  b('tv-pause', 'tv', 'pause', 'Pause', 'monitor', 'orange'),
]

// Правый столбец: только кнопки Marantz — питание, громкость, Mute, входы (живой список), режимы звука, Smart Select 1–4
const AV_HEAD: UniButton[] = [
  b('av-power', 'receiver', 'power', 'Ресивер', 'power', 'orange'),
  b('av-vol-up', 'receiver', 'vol-up', 'Громче', 'volume', 'green'),
  b('av-vol-down', 'receiver', 'vol-down', 'Тише', 'volume', 'green'),
  b('av-mute', 'receiver', 'mute', 'Без звука', 'volume', 'slate'),
]
const AV_TAIL: UniButton[] = [
  b('av-sm-movie', 'receiver', 'sm-movie', 'Movie', 'clapperboard', 'blue'),
  b('av-sm-music', 'receiver', 'sm-music', 'Music', 'radio', 'violet'),
  b('av-sm-game', 'receiver', 'sm-game', 'Game', 'gamepad', 'orange'),
  b('av-sm-pure', 'receiver', 'sm-pure', 'Pure Direct', 'sparkles', 'emerald'),
  b('av-ss-1', 'receiver', 'ss-1', 'Быстрый 1', 'sparkles', 'cyan'),
  b('av-ss-2', 'receiver', 'ss-2', 'Быстрый 2', 'sparkles', 'cyan'),
  b('av-ss-3', 'receiver', 'ss-3', 'Быстрый 3', 'sparkles', 'cyan'),
  b('av-ss-4', 'receiver', 'ss-4', 'Быстрый 4', 'sparkles', 'cyan'),
]
// Входы без живого списка (ресивер ещё не отвечал): те же три, что были в прежнем общем наборе
const FALLBACK_INPUTS = [
  { code: 'TV', name: 'Вход TV' },
  { code: 'SAT/CBL', name: 'Вход CBL/SAT' },
  { code: 'MPLAY', name: 'Вход Media Player' },
]

// Кнопка пульта по коду входа: у ресивера вход — это команда SI<код> (SITV, SISAT/CBL, …)
const inputButton = (code: string): string | null => Object.entries(receiverRemote.REMOTE_DEFAULTS).find(([, cmd]) => cmd === `SI${code}`)?.[0] ?? null
const inputIcon = (name: string): SceneIcon => {
  const n = name.toLowerCase()
  if (/game|ps\d|xbox/.test(n)) return 'gamepad'
  if (/mac|laptop|player|mplay|apple/.test(n)) return 'laptop'
  if (/tv/.test(n)) return 'tv'
  return 'monitor'
}
const slug = (code: string) => code.toLowerCase().replace(/[^a-z0-9]+/g, '')

type Inputs = () => { code: string; name: string }[] | null
const deps: { inputs: Inputs } = { inputs: cachedInputs }
/** Подмена списка входов в тестах: живого ресивера там нет */
export const setInputsSource = (f: Inputs) => void (deps.inputs = f)

/** Плитки входов для набора по умолчанию: живой список входов ресивера, пока его нет — три обычных входа */
function inputDefaults(): UniButton[] {
  const list = deps.inputs() ?? FALLBACK_INPUTS
  const out: UniButton[] = []
  for (const i of list) {
    const button = inputButton(i.code)
    if (!button) continue
    out.push(b(`av-in-${slug(i.code)}`, 'receiver', button, i.name.slice(0, 40), inputIcon(i.name), 'cyan'))
  }
  return out
}

// Выключатели «Умного дома» на пульте: розетка телевизора и два канала настенного выключателя.
// entity_id найдены в реестре Home Assistant (устройство «TV & MARANTZ» — Sonoff S26R1; каналы Balcon и Lamp — SonOff TX2C).
export const SWITCH_TILES: UniButton[] = [
  b('sw-tv-socket', 'switch', 'switch.tv_marantz_sonoff_1000d31d6d', 'Розетка ТВ', 'socket', 'magenta'),
  b('sw-balcon', 'switch', 'switch.sonoff_sonoff_100094626b_1', 'Балкон', 'lightbulb', 'orange'),
  b('sw-lamp', 'switch', 'switch.sonoff_sonoff_100094626b_2', 'Лампа', 'lightbulb', 'brown'),
]

export const defaults = (column: UniColumn): UniButton[] => (column === 'tv' ? [...TV_DEFAULTS, ...SWITCH_TILES] : [...AV_HEAD, ...inputDefaults(), ...AV_TAIL])

// ---------- справочник: что вообще можно положить на пульт ----------
const bindings = (source: 'receiver' | 'tv') => (source === 'receiver' ? receiverRemote.getBindings() : tvRemote.getBindings())
const titles = (source: 'receiver' | 'tv') => {
  const list = source === 'receiver' ? receiverRemote.commandCatalog() : tvRemote.commandCatalog()
  return new Map(list.map((c) => [c.command, c.title]))
}
/** Название кнопки пульта = название команды, которая на ней сейчас стоит (привязки владельца учитываются) */
function buttonTitle(source: 'receiver' | 'tv', button: string): string {
  const cmd = bindings(source)[button] ?? (source === 'receiver' ? receiverRemote.REMOTE_DEFAULTS[button] : tvRemote.REMOTE_DEFAULTS[button])
  return (cmd && titles(source).get(cmd)) || button
}

/** Выключатель: только сущность из белого списка «Умного дома» — switch/light синхронизированного, не скрытого устройства */
export const isSwitch = (entityId: string): boolean =>
  ENTITY_RE.test(entityId) && (CONTROL_DOMAINS as readonly string[]).includes(entityId.split('.')[0]) && Boolean(findControl(entityId))

export const isButton = (source: UniSource, command: string): boolean =>
  source === 'scene'
    ? SCENE_RE.test(command) && Boolean(findScene(command))
    : source === 'switch'
      ? isSwitch(command)
      : Object.hasOwn(source === 'receiver' ? receiverRemote.REMOTE_DEFAULTS : tvRemote.REMOTE_DEFAULTS, command)

/** Управляемые выключатели для диалога «Добавить кнопку»: имя канала и устройство, как на «Умном доме» */
export function switchCatalog(): { command: string; title: string; group: string; available: boolean }[] {
  const out: { command: string; title: string; group: string; available: boolean }[] = []
  for (const d of listDevices()) {
    if (d.source !== 'homeassistant' || d.hidden || d.haMissing) continue
    for (const c of d.ha?.controls ?? []) out.push({ command: c.entityId, title: c.name, group: d.name, available: c.state !== 'unavailable' })
  }
  return out.sort((a, b) => `${a.group} ${a.title}`.localeCompare(`${b.group} ${b.title}`, 'ru'))
}

export type CatalogItem = { command: string; title: string; group: string }
export function catalog(): {
  receiver: CatalogItem[]
  tv: CatalogItem[]
  scenes: { command: string; title: string; color: SceneColor; icon: SceneIcon; available: boolean }[]
  switches: { command: string; title: string; group: string; available: boolean }[]
} {
  const pad = (source: 'receiver' | 'tv', group: string) =>
    (source === 'receiver' ? receiverRemote.REMOTE_BUTTONS : tvRemote.REMOTE_BUTTONS).map((button) => ({ command: button, title: buttonTitle(source, button), group }))
  return {
    receiver: pad('receiver', 'Пульт ресивера'),
    tv: pad('tv', 'Пульт ТВ'),
    scenes: listScenes()
      .filter((s) => !s.hidden && !s.missing)
      .map((s) => ({ command: s.entityId, title: s.name, color: s.color, icon: s.icon, available: s.available })),
    switches: switchCatalog(),
  }
}

// ---------- список кнопок ----------
/** Во что развернётся кнопка: команда ресивера, ключ ТВ или сцена. null — команды нет, плитка серая */
export function resolve(btn: UniButton): { resolved: string | null; title: string; available: boolean } {
  if (btn.source === 'scene') {
    const s = findScene(btn.command)
    return { resolved: s ? s.entityId : null, title: s?.name ?? btn.command, available: Boolean(s?.available) }
  }
  if (btn.source === 'switch') {
    const f = isSwitch(btn.command) ? findControl(btn.command) : null
    if (!f) return { resolved: null, title: 'без команды', available: false }
    return { resolved: btn.command, title: `${f.device.name}: ${f.control.name}`, available: f.control.state !== 'unavailable' }
  }
  const cmd = bindings(btn.source)[btn.command] ?? null
  return { resolved: cmd, title: cmd ? buttonTitle(btn.source, btn.command) : 'без команды', available: cmd !== null }
}

const clean = (v: unknown): UniButton[] => {
  const raw = Array.isArray(v) ? v : []
  const out: UniButton[] = []
  for (const item of raw) {
    const r = parseButton(item, out)
    if (r.ok) out.push(r.value)
  }
  return out
}

/** Перенос прежнего общего списка в два столбца: телевизор и сцены — налево, ресивер — направо. Делается один раз */
export function migrate(): void {
  if (getSetting<boolean>(MIGRATED_KEY, false)) return
  const old = getSetting<unknown>(SETTING_KEY, null)
  if (old !== null) {
    const list = clean(old)
    setSetting(COLUMN_KEY.tv, list.filter((x) => x.source !== 'receiver'))
    setSetting(COLUMN_KEY.receiver, list.filter((x) => x.source === 'receiver'))
  }
  setSetting(MIGRATED_KEY, true)
}

/** Разовое дополнение: дописать плитки-выключатели в конец левого столбца, если владелец уже сохранял свой набор.
 *  Чужие плитки и их порядок не трогаются; список читается как есть, чтобы ничего не выпало при проверке. */
export function addSwitches(): void {
  if (getSetting<boolean>(SWITCHES_KEY, false)) return
  const raw = getSetting<unknown>(COLUMN_KEY.tv, null)
  if (Array.isArray(raw)) {
    const has = (t: UniButton) => raw.some((x) => x !== null && typeof x === 'object' && ((x as UniButton).id === t.id || (x as UniButton).command === t.command))
    const add = SWITCH_TILES.filter((t) => !has(t))
    if (add.length > 0) setSetting(COLUMN_KEY.tv, [...raw, ...add])
  }
  setSetting(SWITCHES_KEY, true)
}

export function getButtons(column: UniColumn): UniButton[] {
  migrate()
  addSwitches()
  const stored = getSetting<unknown>(COLUMN_KEY[column], null)
  return stored === null ? defaults(column) : clean(stored)
}
export const view = (column: UniColumn): UniButtonView[] => getButtons(column).map((x) => ({ ...x, ...resolve(x) }))
export function isDefault(column: UniColumn): boolean {
  migrate()
  addSwitches()
  return getSetting<unknown>(COLUMN_KEY[column], null) === null
}

export function resetButtons(column: UniColumn): UniButton[] {
  migrate()
  addSwitches()
  setSetting(COLUMN_KEY[column], null)
  return defaults(column)
}

type Parsed = { ok: true; value: UniButton } | { ok: false; message: string }
export function parseButton(v: unknown, taken: { id: string }[] = []): Parsed {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id : ''
  if (!ID_RE.test(id)) return { ok: false, message: 'Идентификатор кнопки: латинские буквы, цифры и дефис, до 40 символов' }
  if (taken.some((x) => x.id === id)) return { ok: false, message: `Кнопка «${id}» повторяется` }
  const source = o.source as UniSource
  if (!SOURCES.includes(source)) return { ok: false, message: 'Источник: ресивер, телевизор или сцена' }
  const command = typeof o.command === 'string' ? o.command : ''
  if (!isButton(source, command))
    return { ok: false, message: source === 'scene' ? 'Такой сцены у панели нет' : source === 'switch' ? 'Такого выключателя нет среди устройств панели' : 'Такой кнопки нет на этом пульте' }
  const label = typeof o.label === 'string' ? o.label.trim() : ''
  if (label.length < 1 || label.length > 40) return { ok: false, message: 'Подпись: от 1 до 40 символов' }
  const icon = o.icon as SceneIcon
  if (!(SCENE_ICONS as readonly string[]).includes(icon)) return { ok: false, message: 'Неизвестный значок' }
  const color = o.color as SceneColor
  if (!(SCENE_COLORS as readonly string[]).includes(color)) return { ok: false, message: 'Неизвестный цвет' }
  return { ok: true, value: { id, source, command, label, icon, color } }
}

export function setButtons(column: UniColumn, v: unknown): { ok: true; value: UniButton[] } | { ok: false; message: string } {
  if (!Array.isArray(v)) return { ok: false, message: 'Нужен список кнопок' }
  if (v.length > MAX_BUTTONS) return { ok: false, message: `Кнопок не больше ${MAX_BUTTONS}` }
  const out: UniButton[] = []
  for (const item of v) {
    const r = parseButton(item, out)
    if (!r.ok) return r
    out.push(r.value)
  }
  migrate()
  addSwitches()
  setSetting(COLUMN_KEY[column], out)
  return { ok: true, value: out }
}
