import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth.js'
import { db } from '../db.js'
import { run } from '../exec.js'
import { containerLogs } from '../services/docker.js'
import { readLog } from '../system/logs.js'

// Единая лента: действия из панели (audit_log) + системные события сервера (events)
const FEED = `
  SELECT 'user' AS type, id, ts, ip, user, action AS kind, target, details, result AS level, NULL AS text FROM audit_log
  UNION ALL
  SELECT 'system' AS type, id, ts, NULL AS ip, NULL AS user, kind, target, details, level, text FROM events`

type Q = { limit?: string; offset?: string; type?: string; kind?: string; level?: string; q?: string; from?: string }
type Row = { type: 'user' | 'system'; id: number; ts: number; ip: string | null; user: string | null; kind: string; target: string | null; details: string | null; level: string; text: string | null }

const DAY = 86_400_000

export async function auditRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  app.get<{ Querystring: Q }>('/api/audit', async (req) => {
    const where: string[] = []
    const args: (string | number)[] = []
    const { type, kind, level, q, from } = req.query
    if (type === 'user' || type === 'system') {
      where.push('type = ?')
      args.push(type)
    }
    if (kind) {
      where.push('(kind = ? OR kind LIKE ?)')
      args.push(kind, `${kind}.%`)
    }
    // «Проблемы»: ошибки и отказы действий + предупреждения/ошибки событий
    if (level === 'problems') where.push("level IN ('error', 'denied', 'warning')")
    else if (level) {
      where.push('level = ?')
      args.push(level)
    }
    if (q) {
      where.push('(kind LIKE ? OR target LIKE ? OR details LIKE ? OR text LIKE ? OR ip LIKE ?)')
      args.push(...Array(5).fill(`%${q}%`))
    }
    if (from && Number(from) > 0) {
      where.push('ts >= ?')
      args.push(Number(from))
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 500)
    const offset = Math.max(Number(req.query.offset ?? 0), 0)
    const rows = db.prepare(`SELECT * FROM (${FEED}) ${w} ORDER BY ts DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as Row[]
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM (${FEED}) ${w}`).get(...args) as { total: number }
    return { total, rows: rows.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })) }
  })

  app.get('/api/audit/facets', async () => ({
    kinds: db.prepare(`SELECT type, kind, COUNT(*) AS n FROM (${FEED}) GROUP BY type, kind ORDER BY n DESC`).all(),
  }))

  // Сводка: действия и события за сутки/неделю, проблемы, график по дням (30 дней)
  app.get('/api/audit/summary', async () => {
    const now = Date.now()
    const count = (sql: string, ...a: number[]) => (db.prepare(sql).get(...a) as { n: number }).n
    const since = (ms: number) => now - ms
    const perDay = db
      .prepare(
        `SELECT date(ts / 1000, 'unixepoch', 'localtime') AS day, type,
                SUM(CASE WHEN level IN ('error', 'denied', 'warning') THEN 1 ELSE 0 END) AS problems, COUNT(*) AS n
         FROM (${FEED}) WHERE ts >= ? GROUP BY day, type ORDER BY day`
      )
      .all(since(30 * DAY)) as { day: string; type: string; problems: number; n: number }[]
    return {
      actions: { day: count('SELECT COUNT(*) AS n FROM audit_log WHERE ts >= ?', since(DAY)), week: count('SELECT COUNT(*) AS n FROM audit_log WHERE ts >= ?', since(7 * DAY)) },
      events: { day: count('SELECT COUNT(*) AS n FROM events WHERE ts >= ?', since(DAY)), week: count('SELECT COUNT(*) AS n FROM events WHERE ts >= ?', since(7 * DAY)) },
      problems: {
        day: count(`SELECT COUNT(*) AS n FROM (${FEED}) WHERE ts >= ? AND level IN ('error', 'denied', 'warning')`, since(DAY)),
        week: count(`SELECT COUNT(*) AS n FROM (${FEED}) WHERE ts >= ? AND level IN ('error', 'denied', 'warning')`, since(7 * DAY)),
      },
      perDay,
    }
  })

  // Фрагмент лога вокруг момента записи (±3 мин): журнал службы, контейнера или файла
  app.get<{ Querystring: { type: string; id: string } }>('/api/audit/context', async (req, reply) => {
    const table = req.query.type === 'system' ? 'events' : 'audit_log'
    const col = table === 'events' ? 'kind' : 'action'
    const row = db.prepare(`SELECT ts, ${col} AS kind, target FROM ${table} WHERE id = ?`).get(Number(req.query.id)) as
      | { ts: number; kind: string; target: string | null }
      | undefined
    if (!row) return reply.code(404).send({ message: 'запись не найдена' })
    const { ts, kind, target } = row
    const window = { from: ts - 3 * 60_000, to: ts + 3 * 60_000 }
    let source: string | null = null
    let lines: { ts: number | null; text: string }[] = []
    const journal = async (unit: string) => {
      source = `journal:${unit}`
      const out = await run(
        '/usr/bin/journalctl',
        // @секунды — без часового пояса (время в -S/-U journalctl понимает как местное, --utc влияет только на вывод)
        ['-u', unit, '-S', `@${Math.floor(window.from / 1000)}`, '-U', `@${Math.ceil(window.to / 1000)}`, '-o', 'json', '--output-fields=MESSAGE,__REALTIME_TIMESTAMP', '--no-pager', '-n', '80'],
        { timeoutMs: 15_000 }
      ).catch(() => '')
      lines = out
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .map((j) => ({ ts: Math.floor(Number(j.__REALTIME_TIMESTAMP) / 1000), text: String(j.MESSAGE ?? '') }))
    }
    const file = async (path: string) => {
      source = `file:${path}`
      lines = (await readLog(`file:${path}`, { lines: 60, q: target ?? undefined }).catch(() => ({ lines: [] }))).lines
    }
    if (/^(service|unit)\./.test(kind) && target && /^[\w@.:-]+$/.test(target)) await journal(target)
    else if (kind.startsWith('container.') && target) {
      source = `container:${target}`
      lines = (await containerLogs(target, 400).catch(() => [])).filter((l) => l.ts && l.ts >= window.from && l.ts <= window.to).slice(-80)
    } else if (kind.startsWith('auth.') || kind.startsWith('settings.') || kind.startsWith('network.')) await journal('server-panel.service')
    else if (/^(ssh|ssh-key|session)\./.test(kind)) await journal('ssh.service')
    else if (kind.startsWith('fail2ban.') || kind.startsWith('f2b.')) await file('/var/log/fail2ban.log')
    else if (kind.startsWith('ufw.')) await file('/var/log/ufw.log')
    else if (kind.startsWith('sync.')) await file('/var/log/sync-jetsetter.log')
    else if (kind.startsWith('disk')) await file('/home/hawk/disk-monitor.log')
    return { source, window, lines }
  })
}
