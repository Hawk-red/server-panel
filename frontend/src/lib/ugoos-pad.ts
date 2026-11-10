// Android TV бокс UGOOS SK1 через Home Assistant: правила экранного пульта без React.
// В отличие от tv-pad.ts (Samsung) здесь только один путь связи — Home Assistant, ни «direct»-режима, ни сопряжения нет.
import type { KeyStatus } from './receiver-pad.ts'

export type UgoosStatus = {
  online: boolean
  paired: boolean
  entity: string | null
  /** ключи, которые сейчас можно отправить: остальные кнопки серые */
  keys?: string[]
}

// Повторяются при удержании: громкость и D-pad — та же логика (useHoldButton), что у остальных пультов
const REPEATABLE = new Set(['VOL_UP', 'VOL_DOWN', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT'])
export const isUgoosRepeatable = (k: string | null) => k !== null && REPEATABLE.has(k)

type StatusInput = Pick<UgoosStatus, 'online' | 'paired'> & Partial<Pick<UgoosStatus, 'keys'>>

/** Можно ли нажать кнопку: только есть ли у неё ключ — как у ИК-пульта, статус бокса (online, paired,
 *  список доступных ключей) на нажатие не влияет, нажатие просто отправляет команду */
export function ugoosKeyStatus(key: string | null, _st?: StatusInput): KeyStatus {
  return key === null ? { enabled: false, reason: 'команда не назначена' } : { enabled: true, reason: null }
}

/** Связь: сущность бокса есть и доступна в Home Assistant */
export const ugoosPairLabel = (st: Pick<UgoosStatus, 'paired'> | undefined) =>
  !st ? null : st.paired ? { label: 'через Home Assistant', cls: 'text-muted-foreground' } : { label: 'нет в Home Assistant', cls: 'text-amber-600 dark:text-amber-500' }

export const ugoosStatusLabel = (st: Pick<UgoosStatus, 'online'> | undefined, error = false) =>
  error ? { label: 'нет данных', cls: 'bg-muted-foreground' } : !st ? { label: 'проверяю…', cls: 'bg-muted-foreground' } : st.online ? { label: 'в сети', cls: 'bg-emerald-600' } : { label: 'не отвечает', cls: 'bg-red-600' }
