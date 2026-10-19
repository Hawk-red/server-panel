import { db } from '../db.js'
import { createStatusCache, type DeviceInput, type Status } from './smarthomeCore.js'

export type SmartDevice = DeviceInput & { id: number; createdAt: number; updatedAt: number }
export type SmartDeviceView = SmartDevice & { status: Status }

type Row = { id: number; name: string; kind: SmartDevice['kind']; room: string | null; icon: SmartDevice['icon']; host: string | null; port: number | null; url: string | null; notes: string | null; enabled: number; created_at: number; updated_at: number }
const map = (r: Row): SmartDevice => ({ id: r.id, name: r.name, kind: r.kind, room: r.room, icon: r.icon, host: r.host, port: r.port, url: r.url, notes: r.notes, enabled: r.enabled === 1, createdAt: r.created_at, updatedAt: r.updated_at })

const cache = createStatusCache()

export const listDevices = (): SmartDevice[] => (db.prepare('SELECT * FROM smart_devices ORDER BY id').all() as Row[]).map(map)
export const getDevice = (id: number): SmartDevice | null => {
  const r = db.prepare('SELECT * FROM smart_devices WHERE id = ?').get(id) as Row | undefined
  return r ? map(r) : null
}
export const countDevices = () => (db.prepare('SELECT COUNT(*) AS n FROM smart_devices').get() as { n: number }).n

// Список с состояниями: берёт из кэша, устаревшие проверяет в фоне (запрос не ждёт)
export function listWithStatus(): SmartDeviceView[] {
  return listDevices().map((d) => ({ ...d, status: cache.get(d.id, d).status }))
}

export function createDevice(v: DeviceInput): SmartDevice {
  const now = Date.now()
  const r = db
    .prepare('INSERT INTO smart_devices (name, kind, room, icon, host, port, url, notes, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(v.name, v.kind, v.room, v.icon, v.host, v.port, v.url, v.notes, v.enabled ? 1 : 0, now, now)
  return getDevice(Number(r.lastInsertRowid))!
}

export function updateDevice(id: number, v: DeviceInput): SmartDevice | null {
  const r = db
    .prepare('UPDATE smart_devices SET name=?, kind=?, room=?, icon=?, host=?, port=?, url=?, notes=?, enabled=?, updated_at=? WHERE id=?')
    .run(v.name, v.kind, v.room, v.icon, v.host, v.port, v.url, v.notes, v.enabled ? 1 : 0, Date.now(), id)
  if (r.changes === 0) return null
  cache.forget(id)
  return getDevice(id)
}

export function deleteDevice(id: number): boolean {
  cache.forget(id)
  return db.prepare('DELETE FROM smart_devices WHERE id = ?').run(id).changes > 0
}
