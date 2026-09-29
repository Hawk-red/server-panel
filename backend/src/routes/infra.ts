// Этап 10: интернет, бэкапы, сроки, быстрые действия
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import { errText } from '../mask.js'
import * as adguard from '../services/adguard.js'
import { backupsOverview } from '../services/backups.js'
import { getDeadlineConfig, listDeadlines, refreshDomains, saveDeadlineConfig, type DeadlineConfig } from '../services/deadlines.js'
import * as docker from '../services/docker.js'
import { exchangeState } from '../services/exchange.js'
import { internetStatus, refreshExternalIp } from '../services/internet.js'
import { checkSpeedtestAllowed, getSpeedSchedule, runSpeedtest, saveSpeedSchedule, speedtestState } from '../services/speedtest.js'
import { unitsInfo } from '../services/sites.js'
import { forgetPing, manualPing, pingHistory, PingInputError } from '../services/pinger.js'
import * as qbt from '../services/qbittorrent.js'

type Part<T> = { data: T; error: null } | { data: null; error: string }
async function part<T>(fn: () => Promise<T>): Promise<Part<T>> {
  try {
    return { data: await fn(), error: null }
  } catch (e) {
    return { data: null, error: errText(e) }
  }
}
const who = (req: FastifyRequest) => ({ ip: req.clientIp, user: 'admin' })

export async function infraRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  app.get('/api/internet', async () => internetStatus())
  app.post('/api/internet/refresh-ip', async (req) => {
    await refreshExternalIp(true)
    audit({ ...who(req), action: 'internet.refresh-ip', result: 'ok' })
    return internetStatus().ip
  })

  // Ручной пингер: проверка адреса, история проверок
  app.get('/api/internet/ping/history', async () => pingHistory())
  app.post<{ Body: { host: string; count?: number } }>(
    '/api/internet/ping',
    { schema: { body: { type: 'object', required: ['host'], properties: { host: { type: 'string', maxLength: 300 }, count: { type: 'integer' } } } } },
    async (req, reply) => {
      try {
        const r = await manualPing(req.body.host, req.body.count)
        audit({ ...who(req), action: 'internet.ping', target: r.host, details: { count: r.count, received: r.received, avg: r.avg }, result: 'ok' })
        return r
      } catch (e) {
        const code = e instanceof PingInputError ? 400 : ((e as { statusCode?: number }).statusCode ?? 500)
        if (code !== 429) audit({ ...who(req), action: 'internet.ping', target: String(req.body.host).slice(0, 100), details: { message: errText(e) }, result: code === 400 ? 'denied' : 'error' })
        return reply.code(code).send({ message: errText(e) })
      }
    }
  )
  app.delete<{ Querystring: { host: string } }>('/api/internet/ping/history', async (req, reply) => {
    try {
      forgetPing(req.query.host)
      return pingHistory()
    } catch (e) {
      return reply.code(400).send({ message: errText(e) })
    }
  })

  // Спидтест: запуск в фоне (страница опрашивает состояние), расписание — раз в сутки
  app.get('/api/internet/speedtest', async () => speedtestState())
  app.post('/api/internet/speedtest', async (req, reply) => {
    try {
      checkSpeedtestAllowed('manual')
    } catch (e) {
      return reply.code((e as { statusCode?: number }).statusCode ?? 400).send({ message: (e as Error).message })
    }
    audit({ ...who(req), action: 'internet.speedtest', result: 'ok' })
    void runSpeedtest('manual').catch(() => {})
    return reply.code(202).send({ ok: true })
  })
  app.put<{ Body: { enabled: boolean; time: string; mode?: 'daily' | 'hourly' | 'every3h' } }>(
    '/api/internet/speedtest/schedule',
    { schema: { body: { type: 'object', required: ['enabled', 'time'], properties: { enabled: { type: 'boolean' }, time: { type: 'string', pattern: '^\\d{2}:\\d{2}$' }, mode: { type: 'string', enum: ['daily', 'hourly', 'every3h'] } } } } },
    async (req, reply) => {
      try {
        saveSpeedSchedule(req.body)
        audit({ ...who(req), action: 'settings.speedtest', details: req.body, result: 'ok' })
        return getSpeedSchedule()
      } catch (e) {
        return reply.code((e as { statusCode?: number }).statusCode ?? 500).send({ message: (e as Error).message })
      }
    }
  )

  app.get('/api/exchange', async () => exchangeState())

  app.get('/api/backups', async () => ({ items: await backupsOverview() }))

  app.get('/api/deadlines', async () => ({ items: await listDeadlines(), config: getDeadlineConfig() }))
  app.put<{ Body: DeadlineConfig }>(
    '/api/deadlines/config',
    {
      schema: {
        body: {
          type: 'object',
          required: ['domains', 'manual'],
          properties: {
            domains: { type: 'array', items: { type: 'string', maxLength: 253 }, maxItems: 20 },
            manual: {
              type: 'array',
              maxItems: 50,
              items: {
                type: 'object',
                required: ['title', 'kind', 'date'],
                properties: {
                  id: { type: 'string', maxLength: 40 },
                  title: { type: 'string', maxLength: 80 },
                  kind: { enum: ['domain', 'token', 'other'] },
                  date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
                  note: { type: 'string', maxLength: 200 },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        saveDeadlineConfig(req.body)
        await refreshDomains(true).catch(() => {})
        audit({ ...who(req), action: 'settings.deadlines', details: { domains: req.body.domains.length, manual: req.body.manual.length }, result: 'ok' })
        return { ok: true }
      } catch (e) {
        const err = e as Error & { statusCode?: number }
        return reply.code(err.statusCode ?? 500).send({ message: err.message })
      }
    }
  )

  // Состояние для панели «Быстрые действия»; сами действия — существующие эндпоинты
  // (контейнер qBittorrent: /api/docker/containers/qbittorrent/restart, торренты: /api/torrents/stop-all|start-all,
  // AdGuard: /api/adguard/protection) — они уже пишут в журнал действий.
  app.get('/api/quick', async () => {
    const [container, torrents, protection, alertBot] = await Promise.all([
      part(async () => {
        const c = await docker.getContainer('qbittorrent')
        if (!c) throw new Error('контейнер не найден')
        return { state: c.state }
      }),
      part(qbt.pauseState),
      part(async () => {
        const s = await adguard.status()
        return { enabled: s.protection_enabled, disabledLeftSec: s.protection_disabled_duration ? Math.round(s.protection_disabled_duration / 1000) : null }
      }),
      part(async () => {
        const u = (await unitsInfo(['alert_monitor.service']))[0]
        if (!u) throw new Error('служба alert_monitor не найдена')
        return { active: u.active, sub: u.sub, since: u.since }
      }),
    ])
    return { container, torrents, protection, alertBot }
  })
}
