// Универсальный пульт (два столбца: Samsung и Marantz): правила плиток без React. Команды берутся с сервера уже развёрнутыми (universal.remote),
// доступность считается теми же функциями, что и у оригинальных пультов, — свои правила не заводим.
import { isRepeatable, keyStatus, type KeyStatus } from './receiver-pad.ts'
import type { ReceiverFullState } from './receiver-remote.ts'
import type { SceneColor, SceneIcon } from './smarthome.ts'
import { isTvRepeatable, tvKeyStatus, type TvStatus } from './tv-pad.ts'

export type UniSource = 'receiver' | 'tv' | 'scene'
export type UniButton = { id: string; source: UniSource; command: string; label: string; icon: SceneIcon; color: SceneColor }
/** Плитка с сервера: resolved — настоящая команда (или null), title — её название, available — есть ли что нажимать */
export type UniButtonView = UniButton & { resolved: string | null; title: string; available: boolean }

export type UniCatalog = {
  receiver: { command: string; title: string; group: string }[]
  tv: { command: string; title: string; group: string }[]
  scenes: { command: string; title: string; color: SceneColor; icon: SceneIcon; available: boolean }[]
}
/** Столбцы пульта: слева Samsung (телевизор и сцены), справа Marantz (ресивер); каждый правится отдельно */
export const UNI_COLUMNS = ['tv', 'receiver'] as const
export type UniColumn = (typeof UNI_COLUMNS)[number]
export const UNI_COLUMN_TITLE: Record<UniColumn, string> = { tv: 'Samsung', receiver: 'Marantz' }
export type UniColumnData = { buttons: UniButtonView[]; defaults: UniButton[]; isDefault: boolean }
export type UniData = { columns: Record<UniColumn, UniColumnData>; catalog: UniCatalog; max: number }

export const SOURCE_LABEL: Record<UniSource, string> = { receiver: 'Ресивер', tv: 'Телевизор', scene: 'Сцена' }

export type DeviceState = { receiver: Pick<ReceiverFullState, 'power' | 'inputs'> | undefined; tv: Pick<TvStatus, 'online' | 'paired' | 'driver' | 'keys'> | undefined }

/** Можно ли нажать плитку: правила — от исходного пульта (ресивер) или телевизора; сцена — доступна ли она */
export function uniStatus(b: UniButtonView, st: DeviceState): KeyStatus {
  if (!b.resolved) return { enabled: false, reason: 'команда не назначена' }
  if (b.source === 'receiver') return keyStatus(b.resolved, st.receiver)
  if (b.source === 'tv') return tvKeyStatus(b.resolved, st.tv)
  return b.available ? { enabled: true, reason: null } : { enabled: false, reason: 'сцена недоступна' }
}

/** Удержание с автоповтором — там же, где и на оригинальных пультах (громкость, стрелки) */
export const uniRepeatable = (b: UniButtonView) => (b.source === 'receiver' ? isRepeatable(b.resolved) : b.source === 'tv' ? isTvRepeatable(b.resolved) : false)

/** Свободный идентификатор для новой плитки: uni-1, uni-2, … */
export function nextId(list: { id: string }[]): string {
  const taken = new Set(list.map((b) => b.id))
  for (let i = 1; i <= 100; i++) if (!taken.has(`uni-${i}`)) return `uni-${i}`
  return `uni-${Date.now().toString(36)}`.slice(0, 40)
}

/** Поиск по названию и команде (как в окне выбора команды пультов) */
export function filterItems<T extends { command: string; title: string }>(list: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  return q ? list.filter((c) => `${c.title} ${c.command}`.toLowerCase().includes(q)) : list
}

/** Новая плитка из выбранного в диалоге: подпись и вид по умолчанию — от выбранной кнопки или сцены */
export function draftButton(source: UniSource, item: { command: string; title: string; color?: SceneColor; icon?: SceneIcon }, list: { id: string }[]): UniButton {
  return {
    id: nextId(list),
    source,
    command: item.command,
    label: item.title.slice(0, 40),
    icon: item.icon ?? (source === 'tv' ? 'tv' : source === 'receiver' ? 'volume' : 'sparkles'),
    color: item.color ?? (source === 'tv' ? 'slate' : source === 'receiver' ? 'cyan' : 'green'),
  }
}

/** Добавление и правка плитки: новая уходит в конец, уже стоящая заменяется на месте */
export const upsertButton = (list: UniButton[], b: UniButton): UniButton[] => (list.some((x) => x.id === b.id) ? list.map((x) => (x.id === b.id ? b : x)) : [...list, b])
export const removeButton = (list: UniButton[], id: string): UniButton[] => list.filter((x) => x.id !== id)

export const stripView = (b: UniButtonView | UniButton): UniButton => ({ id: b.id, source: b.source, command: b.command, label: b.label, icon: b.icon, color: b.color })
