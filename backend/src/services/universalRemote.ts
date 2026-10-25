// Универсальный пульт («Медиа» → вкладка «Универсальный»): свой набор крупных плиток из кнопок ресивера, телевизора и сцен.
// Хранится в настройке universal.remote (список и порядок, общие для всех устройств). Новых способов управления нет:
// кнопка ссылается на кнопку уже существующего экранного пульта (её команду решают привязки receiver.remote / tv.remote)
// либо на сцену панели, а исполняют их прежние маршруты со своими белыми списками, лимитами и журналом.
import { getSetting, setSetting } from '../settings.js'
import { SCENE_COLORS, SCENE_ICONS, type SceneColor, type SceneIcon } from './smarthomeScenes.js'
import * as receiverRemote from './receiverRemote.js'
import * as tvRemote from './tvRemote.js'
import { findScene, listScenes } from './smarthome.js'

export const SETTING_KEY = 'universal.remote'
export const MAX_BUTTONS = 48

export type UniSource = 'receiver' | 'tv' | 'scene'
export type UniButton = { id: string; source: UniSource; command: string; label: string; icon: SceneIcon; color: SceneColor }
/** Кнопка плюс то, что про неё знает сервер: во что она развернётся и можно ли её нажать */
export type UniButtonView = UniButton & { resolved: string | null; title: string; available: boolean }

const SOURCES: UniSource[] = ['receiver', 'tv', 'scene']
const ID_RE = /^[a-z0-9-]{1,40}$/
const SCENE_RE = /^scene\.[a-z0-9_]+$/

// Набор по умолчанию: питание обоих устройств, громкость ресивера, навигация телевизора, входы и режимы звука
export const DEFAULTS: UniButton[] = [
  { id: 'tv-power', source: 'tv', command: 'power', label: 'Телевизор', icon: 'power', color: 'red' },
  { id: 'av-power', source: 'receiver', command: 'power', label: 'Ресивер', icon: 'power', color: 'orange' },
  { id: 'av-vol-up', source: 'receiver', command: 'vol-up', label: 'Громче', icon: 'volume', color: 'green' },
  { id: 'av-vol-down', source: 'receiver', command: 'vol-down', label: 'Тише', icon: 'volume', color: 'green' },
  { id: 'av-mute', source: 'receiver', command: 'mute', label: 'Без звука', icon: 'volume', color: 'slate' },
  { id: 'tv-menu', source: 'tv', command: 'menu', label: 'Меню ТВ', icon: 'tv', color: 'slate' },
  { id: 'tv-up', source: 'tv', command: 'nav-up', label: '▲', icon: 'monitor', color: 'slate' },
  { id: 'tv-left', source: 'tv', command: 'nav-left', label: '◀', icon: 'monitor', color: 'slate' },
  { id: 'tv-enter', source: 'tv', command: 'enter', label: 'OK', icon: 'monitor', color: 'blue' },
  { id: 'tv-right', source: 'tv', command: 'nav-right', label: '▶', icon: 'monitor', color: 'slate' },
  { id: 'tv-down', source: 'tv', command: 'nav-down', label: '▼', icon: 'monitor', color: 'slate' },
  { id: 'tv-return', source: 'tv', command: 'return', label: 'Назад', icon: 'monitor', color: 'slate' },
  { id: 'tv-exit', source: 'tv', command: 'exit', label: 'Выход', icon: 'monitor', color: 'slate' },
  { id: 'av-in-tv', source: 'receiver', command: 'in-tv', label: 'Вход TV', icon: 'tv', color: 'cyan' },
  { id: 'av-in-cblsat', source: 'receiver', command: 'in-cblsat', label: 'Вход CBL/SAT', icon: 'monitor', color: 'cyan' },
  { id: 'av-in-mplay', source: 'receiver', command: 'in-mplay', label: 'Вход Media Player', icon: 'laptop', color: 'cyan' },
  { id: 'av-sm-movie', source: 'receiver', command: 'sm-movie', label: 'Movie', icon: 'clapperboard', color: 'blue' },
  { id: 'av-sm-music', source: 'receiver', command: 'sm-music', label: 'Music', icon: 'radio', color: 'violet' },
  { id: 'av-sm-game', source: 'receiver', command: 'sm-game', label: 'Game', icon: 'gamepad', color: 'orange' },
  { id: 'av-sm-pure', source: 'receiver', command: 'sm-pure', label: 'Pure Direct', icon: 'sparkles', color: 'emerald' },
]

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

export const isButton = (source: UniSource, command: string): boolean =>
  source === 'scene' ? SCENE_RE.test(command) && Boolean(findScene(command)) : Object.hasOwn(source === 'receiver' ? receiverRemote.REMOTE_DEFAULTS : tvRemote.REMOTE_DEFAULTS, command)

export type CatalogItem = { command: string; title: string; group: string }
export function catalog(): { receiver: CatalogItem[]; tv: CatalogItem[]; scenes: { command: string; title: string; color: SceneColor; icon: SceneIcon; available: boolean }[] } {
  const pad = (source: 'receiver' | 'tv', group: string) =>
    (source === 'receiver' ? receiverRemote.REMOTE_BUTTONS : tvRemote.REMOTE_BUTTONS).map((b) => ({ command: b, title: buttonTitle(source, b), group }))
  return {
    receiver: pad('receiver', 'Пульт ресивера'),
    tv: pad('tv', 'Пульт ТВ'),
    scenes: listScenes()
      .filter((s) => !s.hidden && !s.missing)
      .map((s) => ({ command: s.entityId, title: s.name, color: s.color, icon: s.icon, available: s.available })),
  }
}

// ---------- список кнопок ----------
/** Во что развернётся кнопка: команда ресивера, ключ ТВ или сцена. null — команды нет, плитка серая */
export function resolve(b: UniButton): { resolved: string | null; title: string; available: boolean } {
  if (b.source === 'scene') {
    const s = findScene(b.command)
    return { resolved: s ? s.entityId : null, title: s?.name ?? b.command, available: Boolean(s?.available) }
  }
  const cmd = bindings(b.source)[b.command] ?? null
  return { resolved: cmd, title: cmd ? buttonTitle(b.source, b.command) : 'без команды', available: cmd !== null }
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

export const getButtons = (): UniButton[] => {
  const stored = getSetting<unknown>(SETTING_KEY, null)
  if (stored === null) return DEFAULTS
  return clean(stored)
}
export const view = (): UniButtonView[] => getButtons().map((b) => ({ ...b, ...resolve(b) }))
export const isDefault = () => getSetting<unknown>(SETTING_KEY, null) === null

export function resetButtons(): UniButton[] {
  setSetting(SETTING_KEY, null)
  return DEFAULTS
}

type Parsed = { ok: true; value: UniButton } | { ok: false; message: string }
export function parseButton(v: unknown, taken: { id: string }[] = []): Parsed {
  const b = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const id = typeof b.id === 'string' ? b.id : ''
  if (!ID_RE.test(id)) return { ok: false, message: 'Идентификатор кнопки: латинские буквы, цифры и дефис, до 40 символов' }
  if (taken.some((x) => x.id === id)) return { ok: false, message: `Кнопка «${id}» повторяется` }
  const source = b.source as UniSource
  if (!SOURCES.includes(source)) return { ok: false, message: 'Источник: ресивер, телевизор или сцена' }
  const command = typeof b.command === 'string' ? b.command : ''
  if (!isButton(source, command)) return { ok: false, message: source === 'scene' ? 'Такой сцены у панели нет' : 'Такой кнопки нет на этом пульте' }
  const label = typeof b.label === 'string' ? b.label.trim() : ''
  if (label.length < 1 || label.length > 40) return { ok: false, message: 'Подпись: от 1 до 40 символов' }
  const icon = b.icon as SceneIcon
  if (!(SCENE_ICONS as readonly string[]).includes(icon)) return { ok: false, message: 'Неизвестный значок' }
  const color = b.color as SceneColor
  if (!(SCENE_COLORS as readonly string[]).includes(color)) return { ok: false, message: 'Неизвестный цвет' }
  return { ok: true, value: { id, source, command, label, icon, color } }
}

export function setButtons(v: unknown): { ok: true; value: UniButton[] } | { ok: false; message: string } {
  if (!Array.isArray(v)) return { ok: false, message: 'Нужен список кнопок' }
  if (v.length > MAX_BUTTONS) return { ok: false, message: `Кнопок не больше ${MAX_BUTTONS}` }
  const out: UniButton[] = []
  for (const item of v) {
    const r = parseButton(item, out)
    if (!r.ok) return r
    out.push(r.value)
  }
  setSetting(SETTING_KEY, out)
  return { ok: true, value: out }
}
