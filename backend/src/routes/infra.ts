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
    const [container, torrents, protection] = await Promise.all([
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
    ])
    return { container, torrents, protection }
  })
}
