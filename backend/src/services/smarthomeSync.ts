import type Database from 'better-sqlite3'
import type { HaDevice } from './haClient.js'

// Запись устройств из Home Assistant в реестр. Ручные устройства (source='manual') не затрагиваются.
// Обновляются имя (если владелец его не менял), комната (область HA) и состояние; блок, скрытие, порядок и значок владельца остаются.
// Пропавшие в HA помечаются ha_missing=1 и не удаляются.
export function applyHaSync(db: Database.Database, list: HaDevice[], now = Date.now()): { added: number; updated: number; missing: number } {
  let added = 0
  let updated = 0
  let missing = 0
  db.transaction(() => {
    const existing = db.prepare("SELECT id, ha_device_id AS haId, ha_missing AS miss FROM smart_devices WHERE source = 'homeassistant'").all() as { id: number; haId: string; miss: number }[]
    const byHa = new Map(existing.map((r) => [r.haId, r]))
    const seen = new Set<string>()
    const upd = db.prepare('UPDATE smart_devices SET name = CASE name_custom WHEN 1 THEN name ELSE ? END, room = ?, ha_info = ?, ha_missing = 0, updated_at = ? WHERE id = ?')
    const ins = db.prepare(
      "INSERT INTO smart_devices (name, kind, room, icon, enabled, source, ha_device_id, ha_info, created_at, updated_at) VALUES (?, 'homeassistant', ?, ?, 1, 'homeassistant', ?, ?, ?, ?)"
    )
    for (const d of list) {
      seen.add(d.id)
      const info = JSON.stringify({ manufacturer: d.manufacturer, model: d.model, integration: d.integration, area: d.area, available: d.available, summary: d.summary })
      const row = byHa.get(d.id)
      if (row) {
        upd.run(d.name.slice(0, 60), d.area, info, now, row.id)
        updated++
      } else {
        ins.run(d.name.slice(0, 60), d.area, d.icon, d.id, info, now, now)
        added++
      }
    }
    const mark = db.prepare('UPDATE smart_devices SET ha_missing = 1 WHERE id = ?')
    for (const r of existing)
      if (!seen.has(r.haId)) {
        if (!r.miss) mark.run(r.id)
        missing++
      }
  })()
  return { added, updated, missing }
}
