// Экранный пульт Samsung AA59-00602A: кнопки, ключи по умолчанию и привязки (настройка tv.remote, общая для всех устройств).
import { getSetting, setSetting } from '../settings.js'
import { isKey, KEYS, TvError } from './tv.js'

export const SETTING_KEY = 'tv.remote'

export const REMOTE_DEFAULTS: Record<string, string | null> = {
  power: 'KEY_POWER',
  source: 'KEY_SOURCE',
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`num-${i}`, `KEY_${i}`])),
  ttx: 'KEY_TTX_MIX',
  prech: 'KEY_PRECH',
  'vol-up': 'KEY_VOLUP',
  'vol-down': 'KEY_VOLDOWN',
  mute: 'KEY_MUTE',
  'ch-list': 'KEY_CH_LIST',
  'p-up': 'KEY_CHUP',
  'p-down': 'KEY_CHDOWN',
  content: 'KEY_CONTENTS',
  menu: 'KEY_MENU',
  guide: 'KEY_GUIDE',
  tools: 'KEY_TOOLS',
  info: 'KEY_INFO',
  'nav-up': 'KEY_UP',
  'nav-down': 'KEY_DOWN',
  'nav-left': 'KEY_LEFT',
  'nav-right': 'KEY_RIGHT',
  enter: 'KEY_ENTER',
  return: 'KEY_RETURN',
  exit: 'KEY_EXIT',
  'color-a': 'KEY_RED',
  'color-b': 'KEY_GREEN',
  'color-c': 'KEY_YELLOW',
  'color-d': 'KEY_CYAN',
  emanual: 'KEY_EMANUAL',
  psize: 'KEY_PICTURE_SIZE',
  ad: 'KEY_AD',
  stop: 'KEY_STOP',
  rew: 'KEY_REWIND',
  play: 'KEY_PLAY',
  pause: 'KEY_PAUSE',
  ff: 'KEY_FF',
}
export const REMOTE_BUTTONS = Object.keys(REMOTE_DEFAULTS)

export type CommandInfo = { command: string; title: string; group: string; verified: boolean }
export const commandCatalog = (): CommandInfo[] =>
  Object.entries(KEYS).map(([command, k]) => ({ command, group: 'Ключи ТВ', title: k.verified ? k.title : `${k.title} — не проверено`, verified: k.verified }))

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
