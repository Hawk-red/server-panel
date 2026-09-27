import { db } from './db.js'

// Небольшие настройки панели, которые меняются из интерфейса (без sudo и .env)
const getQ = db.prepare('SELECT value FROM settings WHERE key = ?')
const setQ = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')

export function getSetting<T>(key: string, fallback: T): T {
  const row = getQ.get(key) as { value: string } | undefined
  if (!row) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

export function setSetting(key: string, value: unknown) {
  setQ.run(key, JSON.stringify(value))
}
