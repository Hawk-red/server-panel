import { db } from './db.js'
import { maskSecrets } from './mask.js'

export type AuditResult = 'ok' | 'error' | 'denied'

const insert = db.prepare(
  `INSERT INTO audit_log (ts, ip, user, action, target, details, result)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
)

// Журнал действий панели: кто, когда, откуда, что и с каким результатом
export function audit(entry: {
  ip: string
  user?: string | null
  action: string
  target?: string | null
  details?: unknown
  result: AuditResult
}) {
  insert.run(
    Date.now(),
    entry.ip,
    entry.user ?? null,
    entry.action,
    entry.target ?? null,
    entry.details === undefined ? null : maskSecrets(JSON.stringify(entry.details)),
    entry.result
  )
}

// Разовая чистка: токены, попавшие в журнал действий до появления маскирования
export function scrubAuditSecrets() {
  const rows = db.prepare(`SELECT id, details FROM audit_log WHERE details LIKE '%:%'`).all() as { id: number; details: string }[]
  const upd = db.prepare('UPDATE audit_log SET details = ? WHERE id = ?')
  let n = 0
  for (const r of rows) {
    const m = maskSecrets(r.details)
    if (m !== r.details) {
      upd.run(m, r.id)
      n++
    }
  }
  return n
}
