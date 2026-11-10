// Экранный пульт UGOOS SK1: кнопки, ключи по умолчанию и привязки (настройка ugoos.remote, общая для всех устройств).
import { getSetting, setSetting } from '../settings.js'
import { isKey, KEYS, TvError } from './ugoos.js'

export const SETTING_KEY = 'ugoos.remote'

export const REMOTE_DEFAULTS: Record<string, string | null> = {
  power: 'POWER',
  mute: 'MUTE',
  'dpad-up': 'DPAD_UP',
  'dpad-down': 'DPAD_DOWN',
  'dpad-left': 'DPAD_LEFT',
  'dpad-right': 'DPAD_RIGHT',
  ok: 'DPAD_CENTER',
  back: 'BACK',
  home: 'HOME',
  menu: 'MENU',
  'vol-up': 'VOL_UP',
  'vol-down': 'VOL_DOWN',
  // Кнопки есть на макете оригинального пульта UGOOS, но без очевидной команды: вторая (серая) кнопка питания,
  // курсор, настройки, микрофон (голосовой ввод — ADB для этого не подходит) и две стрелки под микрофоном —
  // серые «команда не назначена», донастраиваются вручную через «Изменить»
  power2: null,
  cursor: null,
  settings: null,
  mic: null,
  'arrow-up2': null,
  'arrow-down2': null,
  // 6 цветных кружков (быстрый запуск приложений) — пустые слоты, привязка к source_list появится позже
  'app-1': null,
  'app-2': null,
  'app-3': null,
  'app-4': null,
  'app-5': null,
  'app-6': null,
}
export const REMOTE_BUTTONS = Object.keys(REMOTE_DEFAULTS)

export type CommandInfo = { command: string; title: string; group: string; verified: boolean }
export const commandCatalog = (): CommandInfo[] => Object.entries(KEYS).map(([command, k]) => ({ command, group: 'Ключи UGOOS', title: k.title, verified: k.verified }))

export function getOverrides(): Record<string, string | null> {
  const raw = getSetting<Record<string, unknown>>(SETTING_KEY, {})
  const out: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!Object.hasOwn(REMOTE_DEFAULTS, k)) continue
    if (v === null) out[k] = null
    else if (isKey(v)) out[k] = v
  }
  return out
}
export const getBindings = () => ({ ...REMOTE_DEFAULTS, ...getOverrides() })

/** key: ключ из белого списка, null — без команды, undefined — по умолчанию */
export function setBinding(button: string, key: string | null | undefined) {
  if (!Object.hasOwn(REMOTE_DEFAULTS, button)) throw new TvError('Такой кнопки нет', 'bad')
  if (typeof key === 'string' && !isKey(key)) throw new TvError('Эта команда недопустима', 'bad')
  const cur = getOverrides()
  if (key === undefined || key === REMOTE_DEFAULTS[button]) delete cur[button]
  else cur[button] = key
  setSetting(SETTING_KEY, cur)
}
