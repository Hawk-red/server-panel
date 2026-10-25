// Телевизор через Home Assistant: поиск сущностей ТВ, сопоставление кнопок пульта с сервисами HA и их вызов.
// Запись в HA — только сервисами из белого списка haClient (TV_SERVICES) и только для найденной сущности телевизора.
import { config } from '../config.js'
import { getSetting } from '../settings.js'
import { liveTvService, readTvEntities, type TvEntity, type TvServiceApi } from './haClient.js'

// Биты supported_features медиаплеера Home Assistant (MediaPlayerEntityFeature)
export const FEATURE = { PAUSE: 1, VOLUME_MUTE: 8, PREVIOUS_TRACK: 16, NEXT_TRACK: 32, TURN_ON: 128, TURN_OFF: 256, VOLUME_STEP: 1024, SELECT_SOURCE: 2048, STOP: 4096, PLAY: 16_384 } as const
const has = (e: TvEntity, bit: number) => (e.features & bit) === bit

// ---------- поиск сущностей ----------
export type TvHaView = { remote: TvEntity | null; media: TvEntity | null; at: number }
export const EMPTY: TvHaView = { remote: null, media: null, at: 0 }

const REMOTE_KEY = 'tv.haRemote' // ручная замена автопоиску: entity_id
const MEDIA_KEY = 'tv.haMedia'
/** Сущность телевизора: по имени (интеграция Samsung Smart TV называет их samsung…/…tv) */
export const looksLikeTv = (e: TvEntity) => /samsung|телевизор/i.test(`${e.entityId} ${e.name}`) || /(^|[^a-z])tv([^a-z]|$)/i.test(`${e.entityId} ${e.name}`)

export function pickEntities(list: TvEntity[], fixed: { remote?: string | null; media?: string | null } = {}): Omit<TvHaView, 'at'> {
  const of = (domain: string, want: string | null | undefined) => {
    const own = list.filter((e) => e.entityId.startsWith(`${domain}.`))
    return (want ? own.find((e) => e.entityId === want) : own.find(looksLikeTv)) ?? null
  }
  return { remote: of('remote', fixed.remote), media: of('media_player', fixed.media) }
}

export type HaReader = (opts: { url: string; token: string }) => Promise<TvEntity[]>
let reader: HaReader = readTvEntities
let service: TvServiceApi = liveTvService
export const setHaReader = (f: HaReader | null) => void (reader = f ?? readTvEntities)
export const setHaService = (f: TvServiceApi | null) => void (service = f ?? liveTvService)

export const haCacheMs = 10_000
let cache: TvHaView | null = null
export const resetHa = () => void (cache = null)
/** Состояние сущности ТВ из живого события HA (state_changed) */
export function applyTvLive(entityId: string, state: string) {
  if (!cache) return false
  let hit = false
  for (const e of [cache.remote, cache.media]) if (e && e.entityId === entityId) ((e.state = state), (hit = true))
  return hit
}

export async function findTv(force = false): Promise<TvHaView> {
  if (!force && cache && Date.now() - cache.at < haCacheMs) return cache
  if (!config.ha.token) return { ...EMPTY, at: Date.now() }
  const list = await reader({ url: config.ha.url, token: config.ha.token })
  cache = { ...pickEntities(list, { remote: getSetting<string | null>(REMOTE_KEY, null), media: getSetting<string | null>(MEDIA_KEY, null) }), at: Date.now() }
  return cache
}

// ---------- состояние ----------
const DEAD = new Set(['unavailable', 'unknown'])
export const entityOf = (v: TvHaView) => v.media ?? v.remote
/** Телевизор отвечает и не выключен: только тогда идут обычные кнопки (питание выключенного ТВ поднимает сцена) */
export const isOnline = (v: TvHaView) => {
  const e = entityOf(v)
  return Boolean(e) && !DEAD.has(e!.state) && e!.state !== 'off'
}
/** Связь есть: сущность ТВ в HA нашлась и доступна */
export const isLinked = (v: TvHaView) => {
  const e = entityOf(v)
  return Boolean(e) && !DEAD.has(e!.state)
}

// ---------- сопоставление кнопок ----------
export type HaAction = { domain: 'remote' | 'media_player'; service: string; data?: Record<string, unknown> }

/**
 * Что делает кнопка пульта. Есть remote-сущность — любой ключ уходит как есть (remote.send_command).
 * Иначе — только то, что медиаплеер правда умеет (supported_features); остальное null: кнопка серая.
 */
export function planKey(key: string, v: TvHaView): HaAction | null {
  if (v.remote && !DEAD.has(v.remote.state)) return { domain: 'remote', service: 'send_command', data: { command: [key] } }
  const m = v.media
  if (!m || DEAD.has(m.state)) return null
  const media = (service: string, data?: Record<string, unknown>): HaAction => ({ domain: 'media_player', service, data })
  switch (key) {
    case 'KEY_VOLUP':
      return has(m, FEATURE.VOLUME_STEP) ? media('volume_up') : null
    case 'KEY_VOLDOWN':
      return has(m, FEATURE.VOLUME_STEP) ? media('volume_down') : null
    case 'KEY_MUTE':
      return has(m, FEATURE.VOLUME_MUTE) ? media('volume_mute', { is_volume_muted: !(m.muted ?? false) }) : null
    case 'KEY_POWER':
      // включённый ТВ выключаем, выключенный включаем (если HA это умеет — иначе питание идёт сценой)
      return m.state === 'off' ? (has(m, FEATURE.TURN_ON) ? media('turn_on') : null) : has(m, FEATURE.TURN_OFF) ? media('turn_off') : null
    case 'KEY_PLAY':
      return has(m, FEATURE.PLAY) ? media('media_play') : null
    case 'KEY_PAUSE':
      return has(m, FEATURE.PAUSE) ? media('media_pause') : null
    case 'KEY_STOP':
      return has(m, FEATURE.STOP) ? media('media_stop') : null
    default:
      // цифры, стрелки, меню, источник, каналы: отдельных сервисов у медиаплеера нет, выдумывать не из чего
      return null
  }
}

/** Ключи, которые сейчас реально можно отправить (для серых кнопок на странице) */
export const supportedKeys = (keys: string[], v: TvHaView) => keys.filter((k) => planKey(k, v) !== null)

export async function callKey(key: string, v: TvHaView): Promise<HaAction> {
  const plan = planKey(key, v)
  if (!plan) throw new Error('нет сервиса')
  const entityId = (plan.domain === 'remote' ? v.remote : v.media)!.entityId
  await service({ url: config.ha.url, token: config.ha.token, domain: plan.domain, service: plan.service, entityId, data: plan.data })
  return plan
}
