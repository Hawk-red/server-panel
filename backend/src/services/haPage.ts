// Страница «Home Assistant»: сводка состояния для панели. Только чтение — тот же клиент, что и у «Умного дома»
// (состояние синхронизации берём из smarthome, версию — одним GET /api/config). Ни токен, ни адрес с токеном наружу не уходят.
import { config } from '../config.js'
import { HaError, readVersion, type HaStatus } from './haClient.js'
import * as store from './smarthome.js'

export type HaPageStatus = {
  configured: boolean
  status: HaStatus
  message: string | null
  syncedAt: number | null
  live: boolean
  devices: number
  devicesOnline: number
  scenes: number
  version: string | null
  locationName: string | null
}

export const VERSION_TTL_MS = 10 * 60_000

type Reader = typeof readVersion
const deps: { reader: Reader } = { reader: readVersion }
/** Подмена чтения версии в тестах (живых запросов в тестах нет) */
export const setVersionReader = (r: Reader) => void (deps.reader = r)

let versionCache: { at: number; version: string | null; locationName: string | null } | null = null
export const resetVersionCache = () => void (versionCache = null)

/** Версия HA: читается не чаще раза в 10 минут, ошибку не поднимаем — страница покажет статус, а версию «—» */
export async function loadVersion(now = Date.now()): Promise<{ version: string | null; locationName: string | null }> {
  if (versionCache && now - versionCache.at < VERSION_TTL_MS) return { version: versionCache.version, locationName: versionCache.locationName }
  if (!config.ha.token) return { version: null, locationName: null }
  try {
    const v = await deps.reader({ url: config.ha.url, token: config.ha.token })
    versionCache = { at: now, ...v }
    return v
  } catch (e) {
    if (!(e instanceof HaError)) throw e
    return { version: null, locationName: null }
  }
}

/** Сводка для страницы: состояние связи, версия и число устройств из последней синхронизации */
export async function pageStatus(now = Date.now()): Promise<HaPageStatus> {
  store.maybeSyncHa(now)
  const ha = store.haPublic()
  const haDevices = store.listDevices().filter((d) => d.source === 'homeassistant')
  const version = ha.status === 'ok' ? await loadVersion(now) : { version: versionCache?.version ?? null, locationName: versionCache?.locationName ?? null }
  return {
    ...ha,
    devices: haDevices.length,
    devicesOnline: haDevices.filter((d) => !d.haMissing && d.ha?.available).length,
    scenes: store.listScenes().filter((s) => !s.missing).length,
    ...version,
  }
}
