// Системные события сервера (лента в «Журнале действий»): упала/поднялась служба, диск перешёл порог,
// новое устройство, бан fail2ban, перезапуск контейнера, синк с ошибкой.
import { db } from './db.js'

export type EventLevel = 'info' | 'warning' | 'error'

const insert = db.prepare('INSERT INTO events (ts, kind, level, text, target, details) VALUES (?, ?, ?, ?, ?, ?)')
const prune = db.prepare('DELETE FROM events WHERE ts < ?')

export function emitEvent(e: { kind: string; level: EventLevel; text: string; target?: string | null; details?: unknown; ts?: number }) {
  insert.run(e.ts ?? Date.now(), e.kind, e.level, e.text, e.target ?? null, e.details === undefined ? null : JSON.stringify(e.details))
}

export function pruneEvents() {
  prune.run(Date.now() - 365 * 24 * 3600_000)
}
