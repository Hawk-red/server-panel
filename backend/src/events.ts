// Системные события сервера (лента в «Журнале действий»): упала/поднялась служба, диск перешёл порог,
// новое устройство, бан fail2ban, перезапуск контейнера, синк с ошибкой.
import { db } from './db.js'

export type EventLevel = 'info' | 'warning' | 'error'

const insert = db.prepare('INSERT INTO events (ts, kind, level, text, target, details) VALUES (?, ?, ?, ?, ?, ?)')
const prune = db.prepare('DELETE FROM events WHERE ts < ?')

export type ServerEvent = { kind: string; level: EventLevel; text: string; target?: string | null; details?: unknown; ts?: number }
const listeners: ((e: ServerEvent) => void)[] = []

// Подписка на события (уведомления в Telegram и т.п.)
export function onEvent(fn: (e: ServerEvent) => void) {
  listeners.push(fn)
}

export function emitEvent(e: ServerEvent) {
  insert.run(e.ts ?? Date.now(), e.kind, e.level, e.text, e.target ?? null, e.details === undefined ? null : JSON.stringify(e.details))
  for (const fn of listeners) {
    try {
      fn(e)
    } catch {
      /* подписчик не должен ломать запись события */
    }
  }
}

export function pruneEvents() {
  prune.run(Date.now() - 365 * 24 * 3600_000)
}
