import { db } from './db.js'

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
    entry.details === undefined ? null : JSON.stringify(entry.details),
    entry.result
  )
}
