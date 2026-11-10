// Android TV бокс UGOOS SK1: статус и отправка ключей пульта через Home Assistant (интеграция Android Debug Bridge).
// В отличие от tv.ts (Samsung) здесь только один путь — Home Assistant: ни сопряжения, ни прямого WebSocket нет,
// сущности ADB фиксированы в конфиге (config.ugoos).
import { errText } from '../mask.js'
import { HaError } from './haClient.js'
import { TvError } from './tv.js'
import * as ha from './ugoosHa.js'

export { TvError }

/** Белый список ключей: android keyevent-имена без префикса KEYCODE_ (D-pad/HOME/BACK/MENU), плюс громкость/mute/питание медиаплеера */
export const KEYS: Record<string, { title: string; verified: boolean }> = {
  POWER: { title: 'Питание', verified: true },
  HOME: { title: 'Домой', verified: true },
  BACK: { title: 'Назад', verified: true },
  MENU: { title: 'Меню', verified: true },
  DPAD_UP: { title: 'Вверх', verified: true },
  DPAD_DOWN: { title: 'Вниз', verified: true },
  DPAD_LEFT: { title: 'Влево', verified: true },
  DPAD_RIGHT: { title: 'Вправо', verified: true },
  DPAD_CENTER: { title: 'OK (центр)', verified: true },
  VOL_UP: { title: 'Громкость +', verified: true },
  VOL_DOWN: { title: 'Громкость −', verified: true },
  MUTE: { title: 'Mute', verified: true },
}
export const isKey = (k: unknown): k is string => typeof k === 'string' && Object.hasOwn(KEYS, k)
/** Без записи в журнал: слишком частые */
export const QUIET_KEYS = new Set(['VOL_UP', 'VOL_DOWN', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT'])

const STATUS_CACHE_MS = 3000

const haErr = (e: unknown): TvError =>
  e instanceof HaError
    ? new TvError(e.status === 'no-token' ? 'Home Assistant не настроен в панели' : e.status === 'unauthorized' ? 'Home Assistant отклонил токен панели' : `Home Assistant не выполнил команду: ${errText(e)}`, 'offline')
    : new TvError(`Ошибка связи с Home Assistant: ${errText(e)}`, 'offline')

export type UgoosStatus = { online: boolean; paired: boolean; entity: string | null; keys: string[]; at: number }
let cache: UgoosStatus | null = null
export const resetStatus = () => void (cache = null)

export async function getStatus(force = false): Promise<UgoosStatus> {
  if (!force && cache && Date.now() - cache.at < STATUS_CACHE_MS) return cache
  let v: ha.UgoosView
  try {
    v = await ha.findUgoos(force)
  } catch {
    return (cache = { online: false, paired: false, entity: null, keys: [], at: Date.now() }) // HA не ответил: кнопки серые, причина — в ошибке команды
  }
  const e = ha.entityOf(v)
  return (cache = { online: ha.isOnline(v), paired: ha.isLinked(v), entity: e?.entityId ?? null, keys: ha.supportedKeys(Object.keys(KEYS), v), at: Date.now() })
}

export type KeyResult = { key: string; via: string }

export async function sendKey(key: string): Promise<KeyResult> {
  if (!isKey(key)) throw new TvError('Эта кнопка недопустима', 'bad')
  let v: ha.UgoosView
  try {
    v = await ha.findUgoos()
  } catch (e) {
    throw haErr(e)
  }
  if (!ha.entityOf(v)) throw new TvError('Бокс не найден в Home Assistant: проверьте сущности UGOOS в конфиге панели', 'unpaired')
  if (!ha.isLinked(v)) throw new TvError('Home Assistant не видит бокс (сущность недоступна)', 'offline')
  if (!ha.planKey(key, v)) throw new TvError('Эта кнопка через Home Assistant недоступна', 'bad')
  try {
    const plan = await ha.callKey(key, v)
    ha.resetHa() // состояние бокса могло измениться (громкость, питание)
    cache = null
    return { key, via: `Home Assistant, ${plan.domain}.${plan.service}` }
  } catch (e) {
    throw haErr(e)
  }
}
