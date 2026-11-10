// Android TV (UGOOS SK1) через Home Assistant: сущности фиксированы в конфиге (config.ugoos), сопоставление
// кнопок пульта с сервисами HA и их вызов. В отличие от tvHa.ts (Samsung) здесь нет автопоиска по имени —
// обе сущности заданы одной строкой в конфиге, менять незачем.
import { config } from '../config.js'
import { liveTvService, readTvEntities, type TvEntity, type TvServiceApi } from './haClient.js'

export type UgoosView = { remote: TvEntity | null; media: TvEntity | null; at: number }
export const EMPTY: UgoosView = { remote: null, media: null, at: 0 }

export type HaReader = (opts: { url: string; token: string }) => Promise<TvEntity[]>
let reader: HaReader = readTvEntities
let service: TvServiceApi = liveTvService
export const setHaReader = (f: HaReader | null) => void (reader = f ?? readTvEntities)
export const setHaService = (f: TvServiceApi | null) => void (service = f ?? liveTvService)

export const haCacheMs = 10_000
let cache: UgoosView | null = null
export const resetHa = () => void (cache = null)
/** Состояние сущности бокса из живого события HA (state_changed) */
export function applyUgoosLive(entityId: string, state: string) {
  if (!cache) return false
  let hit = false
  for (const e of [cache.remote, cache.media]) if (e && e.entityId === entityId) ((e.state = state), (hit = true))
  return hit
}

export async function findUgoos(force = false): Promise<UgoosView> {
  if (!force && cache && Date.now() - cache.at < haCacheMs) return cache
  if (!config.ha.token) return { ...EMPTY, at: Date.now() }
  const list = await reader({ url: config.ha.url, token: config.ha.token })
  const remote = list.find((e) => e.entityId === config.ugoos.remoteEntity) ?? null
  const media = list.find((e) => e.entityId === config.ugoos.mediaEntity) ?? null
  cache = { remote, media, at: Date.now() }
  return cache
}

// ---------- состояние ----------
const DEAD = new Set(['unavailable', 'unknown'])
export const entityOf = (v: UgoosView) => v.media ?? v.remote
/** Бокс отвечает и не выключен */
export const isOnline = (v: UgoosView) => {
  const e = entityOf(v)
  return Boolean(e) && !DEAD.has(e!.state) && e!.state !== 'off'
}
/** Связь есть: сущность бокса в HA нашлась и доступна */
export const isLinked = (v: UgoosView) => {
  const e = entityOf(v)
  return Boolean(e) && !DEAD.has(e!.state)
}

// ---------- сопоставление кнопок ----------
export type HaAction = { domain: 'remote' | 'media_player'; service: string; data?: Record<string, unknown> }

/** Ключи D-pad/HOME/BACK/MENU: android keyevent-имена без префикса KEYCODE_, уходят как remote.send_command */
const REMOTE_KEYS = new Set(['HOME', 'BACK', 'MENU', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'DPAD_CENTER'])

/**
 * Что делает кнопка пульта. D-pad/HOME/BACK/MENU — только через remote-сущность (ADB), для них у медиаплеера
 * нет аналога. Громкость/mute/питание — через медиаплеер; остальные ключи неизвестны — кнопка серая.
 */
export function planKey(key: string, v: UgoosView): HaAction | null {
  if (REMOTE_KEYS.has(key)) return v.remote && !DEAD.has(v.remote.state) ? { domain: 'remote', service: 'send_command', data: { command: [key] } } : null
  const m = v.media
  if (!m || DEAD.has(m.state)) return null
  switch (key) {
    case 'VOL_UP':
      return { domain: 'media_player', service: 'volume_up' }
    case 'VOL_DOWN':
      return { domain: 'media_player', service: 'volume_down' }
    case 'MUTE':
      return { domain: 'media_player', service: 'volume_mute', data: { is_volume_muted: !(m.muted ?? false) } }
    case 'POWER':
      return m.state === 'off' ? { domain: 'media_player', service: 'turn_on' } : { domain: 'media_player', service: 'turn_off' }
    default:
      return null
  }
}

/** Ключи, которые сейчас реально можно отправить (для серых кнопок на странице) */
export const supportedKeys = (keys: string[], v: UgoosView) => keys.filter((k) => planKey(k, v) !== null)

export async function callKey(key: string, v: UgoosView): Promise<HaAction> {
  const plan = planKey(key, v)
  if (!plan) throw new Error('нет сервиса')
  const entityId = (plan.domain === 'remote' ? v.remote : v.media)!.entityId
  await service({ url: config.ha.url, token: config.ha.token, domain: plan.domain, service: plan.service, entityId, data: plan.data })
  return plan
}
