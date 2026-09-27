import type { FastifyInstance, FastifyRequest } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import * as adguard from '../services/adguard.js'
import * as docker from '../services/docker.js'
import * as media from '../services/media.js'
import * as qbt from '../services/qbittorrent.js'
import { getSetting, setSetting } from '../settings.js'

// Результат подисточника: данные или причина «нет данных» — страница не падает целиком
type Part<T> = { data: T; error: null } | { data: null; error: string }
async function part<T>(fn: () => Promise<T>): Promise<Part<T>> {
  try {
    return { data: await fn(), error: null }
  } catch (e) {
    return { data: null, error: (e as Error).message }
  }
}

const who = (req: FastifyRequest) => ({ ip: req.clientIp, user: 'admin' })

async function containerByName(name: string) {
  return part(async () => {
    const c = await docker.getContainer(name)
    if (!c) throw new Error('контейнер не найден')
    return c
  })
}

export async function serviceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  // ---------- Docker ----------
  app.get('/api/docker', async () => {
    const [version, containers, images] = await Promise.all([
      part(docker.dockerVersion),
      part(() => docker.listContainers(true)),
      part(docker.listImages),
    ])
    return { version, containers, images }
  })

  app.post<{ Params: { name: string; action: string } }>('/api/docker/containers/:name/:action', async (req, reply) => {
    const { name, action } = req.params
    if (!['start', 'stop', 'restart'].includes(action)) return reply.code(400).send({ message: 'недопустимое действие' })
    try {
      await docker.containerAction(name, action as docker.ContainerAction)
      audit({ ...who(req), action: `container.${action}`, target: name, result: 'ok' })
      return { ok: true }
    } catch (e) {
      const err = e as Error & { statusCode?: number }
      audit({ ...who(req), action: `container.${action}`, target: name, result: err.statusCode === 403 ? 'denied' : 'error', details: { message: err.message } })
      return reply.code(err.statusCode ?? 500).send({ message: err.message })
    }
  })

  // Номер окружения Portainer для прямых ссылок #!/<id>/docker/containers/<containerId>
  app.get('/api/settings/portainer', async () => ({ endpointId: getSetting<number | null>('portainer.endpointId', null) }))
  app.put<{ Body: { endpointId: number } }>(
    '/api/settings/portainer',
    { schema: { body: { type: 'object', required: ['endpointId'], properties: { endpointId: { type: 'integer', minimum: 1, maximum: 9999 } } } } },
    async (req) => {
      setSetting('portainer.endpointId', req.body.endpointId)
      audit({ ...who(req), action: 'settings.portainer', details: { endpointId: req.body.endpointId }, result: 'ok' })
      return { ok: true }
    }
  )

  // ---------- Медиа ----------
  app.get('/api/media', async () => {
    const [jfContainer, jfInfo, jfSessions, minim, bubble, marantz] = await Promise.all([
      containerByName('jellyfin'),
      part(media.jellyfinInfo),
      part(media.jellyfinSessions),
      containerByName('minimserver'),
      containerByName('bubbleupnpserver'),
      part(media.marantz),
    ])
    return {
      jellyfin: { container: jfContainer, info: jfInfo, sessions: jfSessions },
      minimserver: { container: minim },
      bubbleupnpserver: { container: bubble },
      marantz,
    }
  })

  // ---------- Торренты ----------
  app.get('/api/torrents', async () => {
    const [container, summary, guard] = await Promise.all([containerByName('qbittorrent'), part(qbt.summary), part(qbt.spaceGuard)])
    return { container, summary, guard }
  })

  app.post<{ Params: { action: string } }>('/api/torrents/:action', async (req, reply) => {
    const { action } = req.params
    if (action !== 'stop-all' && action !== 'start-all') return reply.code(400).send({ message: 'недопустимое действие' })
    try {
      await (action === 'stop-all' ? qbt.stopAll() : qbt.startAll())
      audit({ ...who(req), action: `torrents.${action}`, result: 'ok' })
      return { ok: true }
    } catch (e) {
      audit({ ...who(req), action: `torrents.${action}`, result: 'error', details: { message: (e as Error).message } })
      return reply.code(502).send({ message: (e as Error).message })
    }
  })

  // ---------- AdGuard ----------
  app.get('/api/adguard', async () => {
    const [container, status, stats, interval, querylogSize] = await Promise.all([
      containerByName('adguardhome'),
      part(adguard.status),
      part(adguard.stats),
      part(adguard.statsInterval),
      part(adguard.querylogSize),
    ])
    return { container, status, stats, interval, querylogSize }
  })

  app.post<{ Body: { enabled: boolean; minutes?: number } }>(
    '/api/adguard/protection',
    {
      schema: {
        body: {
          type: 'object',
          required: ['enabled'],
          properties: { enabled: { type: 'boolean' }, minutes: { type: 'integer', minimum: 1, maximum: 1440 } },
        },
      },
    },
    async (req, reply) => {
      const { enabled, minutes } = req.body
      const action = enabled ? 'adguard.protection-on' : 'adguard.protection-off'
      try {
        await adguard.setProtection(enabled, minutes ? minutes * 60_000 : undefined)
        audit({ ...who(req), action, details: minutes ? { minutes } : undefined, result: 'ok' })
        return { ok: true }
      } catch (e) {
        audit({ ...who(req), action, result: 'error', details: { message: (e as Error).message } })
        return reply.code(502).send({ message: (e as Error).message })
      }
    }
  )
}
