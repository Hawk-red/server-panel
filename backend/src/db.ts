import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { config } from './config.js'

mkdirSync(config.dataDir, { recursive: true })

export const db = new Database(path.join(config.dataDir, 'panel.db'))
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('foreign_keys = ON')

// Миграции по номеру версии схемы (PRAGMA user_version)
const migrations: string[] = [
  `
  CREATE TABLE sessions (
    id_hash    TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL,
    ip         TEXT NOT NULL,
    user_agent TEXT
  );
  CREATE TABLE login_failures (
    ip TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE INDEX login_failures_ip_ts ON login_failures (ip, ts);
  CREATE TABLE audit_log (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      INTEGER NOT NULL,
    ip      TEXT NOT NULL,
    user    TEXT,
    action  TEXT NOT NULL,
    target  TEXT,
    details TEXT,
    result  TEXT NOT NULL
  );
  CREATE INDEX audit_log_ts ON audit_log (ts);
  `,
  `
  CREATE TABLE metric_raw (ts INTEGER NOT NULL, name TEXT NOT NULL, value REAL NOT NULL);
  CREATE INDEX metric_raw_name_ts ON metric_raw (name, ts);
  CREATE INDEX metric_raw_ts ON metric_raw (ts);
  CREATE TABLE metric_5m (ts INTEGER NOT NULL, name TEXT NOT NULL, avg REAL NOT NULL, max REAL NOT NULL, PRIMARY KEY (name, ts)) WITHOUT ROWID;
  CREATE TABLE metric_1h (ts INTEGER NOT NULL, name TEXT NOT NULL, avg REAL NOT NULL, max REAL NOT NULL, PRIMARY KEY (name, ts)) WITHOUT ROWID;
  `,
  `
  CREATE TABLE devices (
    mac        TEXT PRIMARY KEY,
    ip         TEXT,
    vendor     TEXT,
    random_mac INTEGER NOT NULL DEFAULT 0,
    hostname   TEXT,
    name       TEXT,
    type       TEXT,
    known      INTEGER NOT NULL DEFAULT 0,
    online     INTEGER NOT NULL DEFAULT 0,
    first_seen INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL,
    ports_scanned_at INTEGER
  );
  CREATE TABLE device_ports (
    mac     TEXT NOT NULL,
    port    INTEGER NOT NULL,
    proto   TEXT NOT NULL,
    service TEXT,
    PRIMARY KEY (mac, port, proto)
  ) WITHOUT ROWID;
  `,
  `
  -- Этап 9: настройки панели, порядок/расположение/заметка устройств, системные события
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
  ALTER TABLE devices ADD COLUMN sort_order INTEGER;
  ALTER TABLE devices ADD COLUMN location TEXT;
  ALTER TABLE devices ADD COLUMN note TEXT;
  CREATE TABLE events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      INTEGER NOT NULL,
    kind    TEXT NOT NULL,   -- unit.failed, unit.recovered, disk.threshold, device.new, f2b.ban, container.restart, sync.error …
    level   TEXT NOT NULL,   -- info | warning | error
    text    TEXT NOT NULL,
    target  TEXT,            -- юнит / точка монтирования / MAC / IP / контейнер
    details TEXT
  );
  CREATE INDEX events_ts ON events (ts);
  `,
  `
  -- Этап 10: история доступности сервисов — ускоряет выборку переходов по конкретному target
  CREATE INDEX events_target_kind ON events (target, kind, ts);
  `,
  `
  -- Вкладка «Обновления»: своя история Docker-образов — прошлого не было, фиксируем смену локального
  -- digest с момента появления этой фичи (см. services/updates.ts)
  CREATE TABLE docker_image_updates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    container   TEXT NOT NULL,
    repo        TEXT NOT NULL,
    old_digest  TEXT,
    new_digest  TEXT NOT NULL,
    detected_at INTEGER NOT NULL
  );
  CREATE INDEX docker_image_updates_detected_at ON docker_image_updates (detected_at);
  `,
  `
  -- Доступ из интернета: откуда создана сессия (internal | external) и был ли второй фактор
  ALTER TABLE sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'internal';
  ALTER TABLE sessions ADD COLUMN second_factor INTEGER NOT NULL DEFAULT 0;
  `,
]

const current = db.pragma('user_version', { simple: true }) as number
for (let v = current; v < migrations.length; v++) {
  db.transaction(() => {
    db.exec(migrations[v])
    db.pragma(`user_version = ${v + 1}`)
  })()
}
