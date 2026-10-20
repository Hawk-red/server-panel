import { db } from '../db.js'
import { config } from '../config.js'
import { errText } from '../mask.js'
import { getSetting, setSetting } from '../settings.js'
import { HaError, readHome, type ControlState, type HaControl, type HaStatus, type HaSummary } from './haClient.js'
import { accentForNewGroup, newGroupId, resolveGroups, type CustomGroup, type Group } from './smarthomeGroups.js'
import { applyHaSync, applySceneSync } from './smarthomeSync.js'
import { defaultColor, defaultIcon, displayName, sceneBlockId, sortScenes, type SceneColor, type SceneIcon, type ScenePatch } from './smarthomeScenes.js'
import { createStatusCache, type DeviceInput, type Status } from './smarthomeCore.js'

export type HaInfo = { manufacturer: string | null; model: string | null; integration: string; area: string | null; available: boolean; summary: HaSummary; controls?: HaControl[] }
export type SmartDevice = DeviceInput & {
  id: number
  createdAt: number
  updatedAt: number
  source: 'manual' | 'homeassistant'
  haDeviceId: string | null
  haMissing: boolean
  ha: HaInfo | null
  groupKey: string | null
  hidden: boolean
}
export type SmartDeviceView = SmartDevice & { status: Status; groupId: string }

type Row = {
  id: number; name: string; kind: SmartDevice['kind']; room: string | null; icon: SmartDevice['icon']; host: string | null; port: number | null; url: string | null; notes: string | null
  enabled: number; created_at: number; updated_at: number; source: SmartDevice['source']; ha_device_id: string | null; ha_info: string | null; ha_missing: number; name_custom: number
  group_key: string | null; hidden: number
}
const parseInfo = (s: string | null): HaInfo | null => {
  try {
    return s ? (JSON.parse(s) as HaInfo) : null
  } catch {
    return null
  }
}
const map = (r: Row): SmartDevice => ({
  id: r.id, name: r.name, kind: r.kind, room: r.room, icon: r.icon, host: r.host, port: r.port, url: r.url, notes: r.notes, enabled: r.enabled === 1, createdAt: r.created_at, updatedAt: r.updated_at,
  source: r.source, haDeviceId: r.ha_device_id, haMissing: r.ha_missing === 1, ha: parseInfo(r.ha_info), groupKey: r.group_key, hidden: r.hidden === 1,
})

const cache = createStatusCache()

export const listDevices = (): SmartDevice[] => (db.prepare('SELECT * FROM smart_devices ORDER BY id').all() as Row[]).map(map)
export const getDevice = (id: number): SmartDevice | null => {
  const r = db.prepare('SELECT * FROM smart_devices WHERE id = ?').get(id) as Row | undefined
  return r ? map(r) : null
}
export const countManual = () => (db.prepare("SELECT COUNT(*) AS n FROM smart_devices WHERE source = 'manual'").get() as { n: number }).n

// Состояние устройства из Home Assistant — по его данным (панель HA не опрашивает чаще, чем раз в 20 с); ручные — проверкой доступности
function statusOf(d: SmartDevice): Status {
  if (d.source === 'homeassistant') {
    if (d.haMissing) return { state: 'unknown', checkedAt: null, latencyMs: null, detail: 'не найдено в HA' }
    return { state: d.ha?.available ? 'online' : 'offline', checkedAt: haState.syncedAt, latencyMs: null, detail: d.ha?.available ? null : 'недоступно' }
  }
  return cache.get(d.id, d).status
}

// ---------- Home Assistant: состояние синхронизации ----------
export const HA_TTL_MS = 20_000
export const haState: { status: HaStatus; message: string | null; syncedAt: number | null; lastAttempt: number; inflight: Promise<void> | null } = {
  status: config.ha.token ? 'pending' : 'no-token', message: null, syncedAt: null, lastAttempt: 0, inflight: null,
}

export type HaReader = typeof readHome
// Одна синхронизация (читает HA, пишет в реестр). Ошибки не бросает: превращает в понятный статус
export async function syncHa(opts: { reader?: HaReader; now?: () => number } = {}): Promise<void> {
  const now = opts.now ?? Date.now
  haState.lastAttempt = now()
  try {
    const { devices, scenes } = await (opts.reader ?? readHome)({ url: config.ha.url, token: config.ha.token })
    applyHaSync(db, devices, now())
    applySceneSync(db, scenes, now())
    haState.status = 'ok'
    haState.message = null
    haState.syncedAt = now()
  } catch (e) {
    const he = e instanceof HaError ? e : null
    haState.status = he?.status ?? 'error'
    haState.message = errText(e).split('\n')[0]
  }
}

// В фоне, не чаще раза в 20 с; запрос списка её не ждёт
export function maybeSyncHa(now = Date.now()) {
  if (!config.ha.token || haState.inflight || now - haState.lastAttempt < HA_TTL_MS) return
  haState.inflight = syncHa().finally(() => (haState.inflight = null))
}
// Принудительно (кнопка «Обновить»): не чаще раза в 5 с
export async function forceSyncHa(): Promise<void> {
  if (!config.ha.token) return
  if (haState.inflight) return haState.inflight
  if (Date.now() - haState.lastAttempt < 5000) return
  haState.inflight = syncHa().finally(() => (haState.inflight = null))
  return haState.inflight
}
export const haPublic = () => ({ configured: Boolean(config.ha.token), status: haState.status, message: haState.message, syncedAt: haState.syncedAt })

// ---------- блоки ----------
const GROUPS_KEY = 'smarthome.groups'
export const customGroups = (): CustomGroup[] => getSetting<CustomGroup[]>(GROUPS_KEY, [])

export function addGroup(name: string): CustomGroup {
  const list = customGroups()
  const g: CustomGroup = { id: newGroupId(), name, accent: accentForNewGroup(list.length), icon: 'folder' }
  setSetting(GROUPS_KEY, [...list, g])
  return g
}
export function renameGroup(id: string, name: string): CustomGroup | null {
  const list = customGroups()
  const g = list.find((x) => x.id === id)
  if (!g) return null
  g.name = name
  setSetting(GROUPS_KEY, list)
  return g
}
export function removeGroup(id: string): boolean {
  const list = customGroups()
  if (!list.some((x) => x.id === id)) return false
  setSetting(GROUPS_KEY, list.filter((x) => x.id !== id))
  db.prepare('UPDATE smart_devices SET group_key = NULL WHERE group_key = ?').run(id) // устройства возвращаются в блок по умолчанию
  return true
}

// Блоки, существующие сейчас (для проверки «переместить в блок»)
export const currentGroups = (): Group[] => resolveGroups(listDevices().filter((d) => !d.hidden), customGroups()).groups

export function listView() {
  const all = listDevices()
  const visible = all.filter((d) => !d.hidden)
  const { groups, groupOf } = resolveGroups(visible, customGroups())
  const view = (d: SmartDevice): SmartDeviceView => ({ ...d, status: statusOf(d), groupId: groupOf.get(d.id) ?? '' })
  return { devices: visible.map(view), hidden: all.filter((d) => d.hidden).map((d): SmartDeviceView => ({ ...d, status: { state: 'unknown', checkedAt: null, latencyMs: null, detail: null }, groupId: '' })), groups }
}

// ---------- запись ----------
export function createDevice(v: DeviceInput): SmartDevice {
  const now = Date.now()
  const r = db
    .prepare('INSERT INTO smart_devices (name, kind, room, icon, host, port, url, notes, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(v.name, v.kind, v.room, v.icon, v.host, v.port, v.url, v.notes, v.enabled ? 1 : 0, now, now)
  return getDevice(Number(r.lastInsertRowid))!
}

export function updateDevice(id: number, v: DeviceInput): SmartDevice | null {
  const r = db
    .prepare("UPDATE smart_devices SET name=?, kind=?, room=?, icon=?, host=?, port=?, url=?, notes=?, enabled=?, updated_at=? WHERE id=? AND source='manual'")
    .run(v.name, v.kind, v.room, v.icon, v.host, v.port, v.url, v.notes, v.enabled ? 1 : 0, Date.now(), id)
  if (r.changes === 0) return null
  cache.forget(id)
  return getDevice(id)
}

// Выбор владельца: имя (у устройства из HA фиксируется и не затирается синхронизацией), блок, скрытие
export function patchDevice(id: number, p: { name?: string; groupKey?: string | null; hidden?: boolean }): SmartDevice | null {
  const d = getDevice(id)
  if (!d) return null
  const sets: string[] = []
  const args: unknown[] = []
  if (p.name !== undefined) {
    sets.push('name = ?', 'name_custom = 1')
    args.push(p.name)
  }
  if (p.groupKey !== undefined) {
    sets.push('group_key = ?')
    args.push(p.groupKey)
  }
  if (p.hidden !== undefined) {
    sets.push('hidden = ?')
    args.push(p.hidden ? 1 : 0)
  }
  if (sets.length === 0) return d
  db.prepare(`UPDATE smart_devices SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...args, Date.now(), id)
  return getDevice(id)
}

export function deleteDevice(id: number): boolean {
  cache.forget(id)
  return db.prepare('DELETE FROM smart_devices WHERE id = ?').run(id).changes > 0
}

// ---------- управление: поиск сущности среди синхронизированных устройств ----------
// Сущность допустима, только если она есть у устройства HA в реестре панели, которое не скрыто и не пропало из HA
export function findControl(entityId: string): { device: SmartDevice; control: HaControl } | null {
  for (const d of listDevices()) {
    if (d.source !== 'homeassistant' || d.hidden || d.haMissing) continue
    const control = d.ha?.controls?.find((c) => c.entityId === entityId)
    if (control) return { device: d, control }
  }
  return null
}

// После переключения подставляем реальное состояние в реестр (и итог «включено N из M»), не дожидаясь следующей синхронизации
export function setControlState(deviceId: number, entityId: string, state: ControlState) {
  const d = getDevice(deviceId)
  if (!d?.ha?.controls) return
  const controls = d.ha.controls.map((c) => (c.entityId === entityId ? { ...c, state } : c))
  const usable = controls.filter((c) => c.state !== 'unavailable')
  const on = usable.filter((c) => c.state === 'on').length
  let summary = d.ha.summary
  if (usable.length > 0 && /^(включено|выключено)/.test(summary.text))
    summary = { ...summary, text: usable.length === 1 ? (on ? 'включено' : 'выключено') : `включено ${on} из ${usable.length}`, tone: on > 0 ? 'on' : 'off' }
  db.prepare('UPDATE smart_devices SET ha_info = ? WHERE id = ?').run(JSON.stringify({ ...d.ha, controls, summary }), deviceId)
}

// ---------- сцены (плитки «Быстрые сцены») ----------
type SceneRow = { entity_id: string; ha_name: string; name: string | null; color: string | null; icon: string | null; hidden: number; missing: number; available: number; first_seen: number }
export type SceneView = {
  id: string // id блока для порядка плиток
  entityId: string
  name: string // имя владельца или имя из HA (буквы через пробел склеены)
  haName: string
  nameCustom: boolean
  color: SceneColor
  icon: SceneIcon
  hidden: boolean
  missing: boolean
  available: boolean
}
const sceneView = (r: SceneRow): SceneView => ({
  id: sceneBlockId(r.entity_id), entityId: r.entity_id, name: r.name ?? displayName(r.ha_name), haName: r.ha_name, nameCustom: r.name !== null,
  color: (r.color as SceneColor | null) ?? defaultColor(r.entity_id, r.ha_name), icon: (r.icon as SceneIcon | null) ?? defaultIcon(r.entity_id, r.ha_name),
  hidden: r.hidden === 1, missing: r.missing === 1, available: r.available === 1,
})
export function listScenes(): SceneView[] {
  const rows = db.prepare('SELECT * FROM smart_scenes').all() as SceneRow[]
  const order = new Map(sortScenes(rows.map((r) => ({ entityId: r.entity_id, firstSeen: r.first_seen }))).map((x, i) => [x.entityId, i]))
  return rows.sort((a, b) => order.get(a.entity_id)! - order.get(b.entity_id)!).map(sceneView)
}
// Сцену можно запускать, только если она есть в реестре панели, не скрыта и не пропала из HA
export const findScene = (entityId: string): SceneView | null => listScenes().find((s) => s.entityId === entityId && !s.hidden && !s.missing) ?? null
export const sceneExists = (entityId: string): boolean => Boolean(db.prepare('SELECT 1 FROM smart_scenes WHERE entity_id = ?').get(entityId))

export function patchScene(entityId: string, p: ScenePatch): SceneView | null {
  if (!sceneExists(entityId)) return null
  const sets: string[] = []
  const args: unknown[] = []
  if (p.name !== undefined) (sets.push('name = ?'), args.push(p.name))
  if (p.color !== undefined) (sets.push('color = ?'), args.push(p.color))
  if (p.icon !== undefined) (sets.push('icon = ?'), args.push(p.icon))
  if (p.hidden !== undefined) (sets.push('hidden = ?'), args.push(p.hidden ? 1 : 0))
  if (sets.length > 0) db.prepare(`UPDATE smart_scenes SET ${sets.join(', ')}, updated_at = ? WHERE entity_id = ?`).run(...args, Date.now(), entityId)
  return listScenes().find((s) => s.entityId === entityId) ?? null
}
