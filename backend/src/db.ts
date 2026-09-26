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
]

const current = db.pragma('user_version', { simple: true }) as number
for (let v = current; v < migrations.length; v++) {
  db.transaction(() => {
    db.exec(migrations[v])
    db.pragma(`user_version = ${v + 1}`)
  })()
}
