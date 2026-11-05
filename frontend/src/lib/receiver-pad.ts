// Экранный пульт Marantz RC042SR: правила кнопок без React (доступность, удержание, поиск команды).
import type { ReceiverFullState } from './receiver-remote.ts'

export type RemoteConfig = {
  defaults: Record<string, string | null>
  bindings: Record<string, string | null>
  commands: { command: string; title: string; group: string }[]
}

// Команды, которые повторяются при удержании: громкость, стрелки меню, шаг частоты тюнера (сервер всё равно держит лимит 4 в секунду)
const REPEATABLE = new Set(['MVUP', 'MVDOWN', 'MNCUP', 'MNCDN', 'MNCLT', 'MNCRT', 'TFANUP', 'TFANDOWN'])
export const isRepeatable = (cmd: string | null) => cmd !== null && REPEATABLE.has(cmd)

// Питание и зоны можно переключать из режима ожидания, остальное раньше требовало включённого ресивера —
// сейчас это не влияет на нажатие (см. keyStatus), но остаётся для будущего визуального индикатора
const ALWAYS = /^(PWON|PWSTANDBY|PWTOGGLE|ZMON|ZMOFF|ZMTOGGLE|Z2ON|Z2OFF|Z2TOGGLE)$/
export const needsPower = (cmd: string) => !ALWAYS.test(cmd)

export type KeyStatus = { enabled: boolean; reason: string | null }

/** Можно ли нажать кнопку: только есть ли у неё команда — как у ИК-пульта, статус ресивера (питание,
 *  связь, живой список входов) на нажатие не влияет, нажатие просто отправляет команду */
export function keyStatus(cmd: string | null, _st?: Pick<ReceiverFullState, 'power' | 'inputs'>): KeyStatus {
  return cmd === null ? { enabled: false, reason: 'команда не назначена' } : { enabled: true, reason: null }
}

/** Живое имя входа под подписью кнопки (если кнопка привязана ко входу из списка ресивера) */
export function liveInputName(cmd: string | null, st: Pick<ReceiverFullState, 'inputs'> | undefined): string | null {
  if (!cmd || !/^SI./.test(cmd)) return null
  return st?.inputs.find((i) => `SI${i.code}` === cmd)?.name ?? null
}

/** Поиск по названию, команде и группе; пустой запрос — весь список */
export function filterCommands<T extends { command: string; title: string; group: string }>(list: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter((c) => `${c.title} ${c.command} ${c.group}`.toLowerCase().includes(q))
}

/** Название команды для подписи привязки */
export const commandTitle = (cfg: Pick<RemoteConfig, 'commands'>, cmd: string | null) => (cmd === null ? 'без команды' : (cfg.commands.find((c) => c.command === cmd)?.title ?? cmd))

/** Привязка отличается от значения по умолчанию */
export const isCustom = (cfg: Pick<RemoteConfig, 'defaults' | 'bindings'>, id: string) => cfg.bindings[id] !== cfg.defaults[id]
