import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth.js'
import { db } from '../db.js'

type Q = { limit?: string; offset?: string; action?: string; result?: string; ip?: string; q?: string; from?: string; to?: string }

export async function auditRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  // Журнал действий панели: фильтры по действию, результату, IP, тексту и периоду
  app.get<{ Querystring: Q }>('/api/audit', async (req) => {
    const where: string[] = []
    const args: (string | number)[] = []
    const { action, result, ip, q, from, to } = req.query
    if (action) {
      where.push('(action = ? OR action LIKE ?)')
      args.push(action, `${action}.%`)
    }
    if (result && ['ok', 'error', 'denied'].includes(result)) {
      where.push('result = ?')
      args.push(result)
    }
    if (ip) {
      where.push('ip = ?')
      args.push(ip)
    }
    if (q) {
      where.push('(action LIKE ? OR target LIKE ? OR details LIKE ?)')
      args.push(`%${q}%`, `%${q}%`, `%${q}%`)
    }
    if (from && Number(from) > 0) {
      where.push('ts >= ?')
      args.push(Number(from))
    }
    if (to && Number(to) > 0) {
      where.push('ts <= ?')
      args.push(Number(to))
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 500)
    const offset = Math.max(Number(req.query.offset ?? 0), 0)
    const rows = db.prepare(`SELECT * FROM audit_log ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as {
      id: number
      ts: number
      ip: string
      user: string | null
      action: string
      target: string | null
      details: string | null
      result: string
    }[]
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM audit_log ${w}`).get(...args) as { total: number }
    return {
      total,
      rows: rows.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })),
    }
  })

  app.get('/api/audit/facets', async () => ({
    actions: (db.prepare('SELECT action, COUNT(*) AS n FROM audit_log GROUP BY action ORDER BY n DESC').all() as { action: string; n: number }[]),
    ips: (db.prepare('SELECT ip, COUNT(*) AS n FROM audit_log GROUP BY ip ORDER BY n DESC LIMIT 20').all() as { ip: string; n: number }[]),
  }))
}
