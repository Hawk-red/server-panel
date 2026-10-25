// Телевизор Samsung и его экранный пульт: правила кнопок без React.
import type { KeyStatus } from './receiver-pad.ts'

export type TvStatus = {
  online: boolean
  port: 8001 | 8002 | null
  paired: boolean
  tokenAuth: boolean | null
  /** ha — команды идут через Home Assistant; direct — прямой WebSocket к телевизору (запасной путь) */
  driver: 'ha' | 'direct'
  entity: string | null
  /** ключи, которые сейчас можно отправить: остальные кнопки серые */
  keys?: string[]
  host: string
  sceneOn: string
}

/** Что сделать на телевизоре, если окно «Разрешить» не появляется (тот же текст, что в ошибках сервера) */
export const TV_ACCESS_HINT = 'Настройки → Общие → Менеджер внешних устройств → Менеджер подключения устройств: включить «Уведомление о доступе», в «Списке устройств» удалить запись панели.'

// Повторяются при удержании: громкость и стрелки (сервер держит лимит 5 ключей в секунду)
const REPEATABLE = new Set(['KEY_VOLUP', 'KEY_VOLDOWN', 'KEY_UP', 'KEY_DOWN', 'KEY_LEFT', 'KEY_RIGHT'])
export const isTvRepeatable = (k: string | null) => k !== null && REPEATABLE.has(k)

/** Питание: если ТВ не отвечает по сети — запускается сцена (scene.tv_on), иначе KEY_POWER */
export const powerVia = (st: Pick<TvStatus, 'online'> | undefined): 'scene' | 'key' => (st?.online ? 'key' : 'scene')

type StatusInput = Pick<TvStatus, 'online' | 'paired'> & Partial<Pick<TvStatus, 'keys' | 'driver'>>

export function tvKeyStatus(key: string | null, st: StatusInput | undefined): KeyStatus {
  if (key === null) return { enabled: false, reason: 'команда не назначена' }
  if (!st) return { enabled: false, reason: 'нет данных о телевизоре' }
  // выключенный ТВ включает сцена, поэтому питание активно всегда
  const power = key === 'KEY_POWER' && !st.online
  if (!power && st.keys && !st.keys.includes(key)) return { enabled: false, reason: st.driver === 'direct' ? 'кнопка недоступна' : 'через Home Assistant недоступно' }
  if (key === 'KEY_POWER') return { enabled: true, reason: null }
  if (!st.online) return { enabled: false, reason: 'ТВ не отвечает' }
  if (!st.paired) return { enabled: false, reason: st.driver === 'ha' ? 'телевизора нет в Home Assistant' : 'ТВ не сопряжён' }
  return { enabled: true, reason: null }
}

/** Связь — отдельно от «в сети»: через HA это наличие сущности ТВ, в прямом режиме — полученный токен */
export const tvPairLabel = (st: (Pick<TvStatus, 'online' | 'paired'> & Partial<Pick<TvStatus, 'driver'>>) | undefined) => {
  if (!st) return null
  if (st.driver === 'ha') return st.paired ? { label: 'через Home Assistant', cls: 'text-muted-foreground' } : { label: 'нет в Home Assistant', cls: 'text-amber-600 dark:text-amber-500' }
  if (!st.online) return null
  return st.paired ? { label: 'сопряжён', cls: 'text-muted-foreground' } : { label: 'не сопряжён', cls: 'text-amber-600 dark:text-amber-500' }
}

export const tvStatusLabel = (st: Pick<TvStatus, 'online' | 'paired'> | undefined, error = false) =>
  error ? { label: 'нет данных', cls: 'bg-muted-foreground' } : !st ? { label: 'проверяю…', cls: 'bg-muted-foreground' } : st.online ? { label: 'в сети', cls: 'bg-emerald-600' } : { label: 'не отвечает', cls: 'bg-red-600' }
