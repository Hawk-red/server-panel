// Телевизор Samsung и его экранный пульт: правила кнопок без React.
import type { KeyStatus } from './receiver-pad.ts'

export type TvStatus = { online: boolean; port: 8001 | 8002 | null; paired: boolean; host: string; sceneOn: string }

// Повторяются при удержании: громкость и стрелки (сервер держит лимит 5 ключей в секунду)
const REPEATABLE = new Set(['KEY_VOLUP', 'KEY_VOLDOWN', 'KEY_UP', 'KEY_DOWN', 'KEY_LEFT', 'KEY_RIGHT'])
export const isTvRepeatable = (k: string | null) => k !== null && REPEATABLE.has(k)

/** Питание: если ТВ не отвечает по сети — запускается сцена (scene.tv_on), иначе KEY_POWER */
export const powerVia = (st: Pick<TvStatus, 'online'> | undefined): 'scene' | 'key' => (st?.online ? 'key' : 'scene')

export function tvKeyStatus(key: string | null, st: Pick<TvStatus, 'online' | 'paired'> | undefined): KeyStatus {
  if (key === null) return { enabled: false, reason: 'команда не назначена' }
  if (!st) return { enabled: false, reason: 'нет данных о телевизоре' }
  if (key === 'KEY_POWER') return { enabled: true, reason: null } // выключенный ТВ включает сцена
  if (!st.online) return { enabled: false, reason: 'ТВ не отвечает' }
  if (!st.paired) return { enabled: false, reason: 'ТВ не сопряжён' }
  return { enabled: true, reason: null }
}

export const tvStatusLabel = (st: Pick<TvStatus, 'online' | 'paired'> | undefined, error = false) =>
  error ? { label: 'нет данных', cls: 'bg-muted-foreground' } : !st ? { label: 'проверяю…', cls: 'bg-muted-foreground' } : st.online ? { label: 'в сети', cls: 'bg-emerald-600' } : { label: 'не отвечает', cls: 'bg-red-600' }
