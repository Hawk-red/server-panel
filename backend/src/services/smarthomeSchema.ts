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
