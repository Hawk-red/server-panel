// Схема реестра устройств «Умного дома». Отдельным файлом без побочных эффектов: её берут и db.ts (миграция), и тесты
export const SMART_DEVICES_DDL = `
  -- Реестр устройств умного дома (страница «Умный дом»): только описание и проверка доступности, команд устройствам нет
  CREATE TABLE smart_devices (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL,                -- link | http | tcp | ping | homeassistant
    room       TEXT,
    icon       TEXT NOT NULL DEFAULT 'other',
    host       TEXT,
    port       INTEGER,
    url        TEXT,
    notes      TEXT,
    enabled    INTEGER NOT NULL DEFAULT 1,   -- 0 — устройство не проверяется
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX smart_devices_room ON smart_devices (room);
`

// Устройства из Home Assistant (только чтение) и раскладка по блокам. Ручные устройства остаются source='manual'.
// name_custom / group_key / hidden — выбор владельца: синхронизация с HA их не сбрасывает.
export const SMART_DEVICES_HA_DDL = `
  ALTER TABLE smart_devices ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';  -- manual | homeassistant
  ALTER TABLE smart_devices ADD COLUMN ha_device_id TEXT;
  ALTER TABLE smart_devices ADD COLUMN ha_info TEXT;                            -- JSON: производитель, модель, интеграция, область, состояние
  ALTER TABLE smart_devices ADD COLUMN ha_missing INTEGER NOT NULL DEFAULT 0;   -- 1: в HA больше не найдено (не удаляется само)
  ALTER TABLE smart_devices ADD COLUMN name_custom INTEGER NOT NULL DEFAULT 0;  -- имя изменено владельцем
  ALTER TABLE smart_devices ADD COLUMN group_key TEXT;                          -- блок, выбранный владельцем (NULL — по умолчанию)
  ALTER TABLE smart_devices ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
  CREATE UNIQUE INDEX smart_devices_ha_id ON smart_devices (ha_device_id) WHERE ha_device_id IS NOT NULL;
`

// Сцены Home Assistant (scene.*) для блока «Быстрые сцены». ha_name — имя из HA; name/color/icon/hidden — выбор владельца,
// синхронизация их не трогает. Пропавшие в HA помечаются missing=1 и не удаляются. Порядок плиток — layout.smarthome-scenes.
export const SMART_SCENES_DDL = `
  CREATE TABLE smart_scenes (
    entity_id  TEXT PRIMARY KEY,
    ha_name    TEXT NOT NULL,
    name       TEXT,                             -- имя владельца (NULL — показывать имя из HA)
    color      TEXT,                             -- NULL — цвет по умолчанию
    icon       TEXT,                             -- NULL — значок по умолчанию
    hidden     INTEGER NOT NULL DEFAULT 0,
    missing    INTEGER NOT NULL DEFAULT 0,
    available  INTEGER NOT NULL DEFAULT 1,
    first_seen INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`
