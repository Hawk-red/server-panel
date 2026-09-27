import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import * as access from '../services/access.js'

type Part<T> = { data: T; error: null } | { data: null; error: string }
const errText = (e: unknown) => {
  const msg = (e as { stderr?: string; message?: string }).stderr?.trim() || (e as Error).message
  if (/password is required|not allowed/i.test(msg)) return 'нет прав (sudoers / server-panel-helper не установлен)'
  return msg.replace(/^server-panel-helper: /, '')
}
async function part<T>(fn: () => Promise<T>): Promise<Part<T>> {
  try {
    return { data: await fn(), error: null }
  } catch (e) {
    return { data: null, error: errText(e) }
  }
}

export const SSH_STOP_PHRASE = 'ОТКЛЮЧИТЬ SSH'

async function act(req: FastifyRequest, reply: FastifyReply, action: string, target: string | null, fn: () => Promise<unknown>) {
  try {
    await fn()
    audit({ ip: req.clientIp, user: 'admin', action, target, result: 'ok' })
    return { ok: true }
  } catch (e) {
    const message = errText(e)
    audit({ ip: req.clientIp, user: 'admin', action, target, result: 'error', details: { message } })
    return reply.code(400).send({ message })
  }
}

const ipBody = { type: 'object', required: ['ip'], properties: { ip: { type: 'string', maxLength: 64 } } } as const
const keyBody = {
  type: 'object',
  required: ['user', 'fingerprint'],
  properties: { user: { type: 'string', maxLength: 32 }, fingerprint: { type: 'string', maxLength: 60 } },
} as const
const jailBody = {
  type: 'object',
  required: ['jail', 'ip'],
  properties: { jail: { type: 'string', maxLength: 32 }, ip: { type: 'string', maxLength: 64 } },
} as const

export async function accessRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  app.get('/api/access', async () => {
    const [ssh, keys, sessions, history, f2b, ufw, remote, wg] = await Promise.all([
      part(access.sshInfo),
      part(access.listKeys),
      part(access.activeSessions),
      part(() => access.loginHistory(7)),
      part(access.fail2ban),
      part(access.ufwDenies),
      part(access.remoteDesktop),
      part(access.wireguard),
    ])
    return { ssh, keys, sessions, history, f2b, ufw, remote, wg }
  })

  app.post<{ Body: { user: string; fingerprint: string } }>('/api/access/keys/:action', { schema: { body: keyBody } }, async (req, reply) => {
    const action = (req.params as { action: string }).action
    if (action !== 'disable' && action !== 'enable') return reply.code(400).send({ message: 'недопустимое действие' })
    const { user, fingerprint } = req.body
    return act(req, reply, `ssh-key.${action}`, `${user} ${fingerprint}`, () => access.helper([`key-${action}`, user, fingerprint]))
  })

  app.post<{ Body: { ip: string } }>('/api/access/ufw/:action', { schema: { body: ipBody } }, async (req, reply) => {
    const action = (req.params as { action: string }).action
    if (action !== 'deny' && action !== 'undeny') return reply.code(400).send({ message: 'недопустимое действие' })
    return act(req, reply, `ufw.${action}`, req.body.ip, () => access.helper([`ufw-${action}`, req.body.ip]))
  })

  app.post<{ Body: { jail: string; ip: string } }>('/api/access/f2b/:action', { schema: { body: jailBody } }, async (req, reply) => {
    const action = (req.params as { action: string }).action
    if (action !== 'ban' && action !== 'unban') return reply.code(400).send({ message: 'недопустимое действие' })
    return act(req, reply, `fail2ban.${action}`, `${req.body.jail} ${req.body.ip}`, () => access.helper([`f2b-${action}`, req.body.jail, req.body.ip]))
  })

  app.post<{ Params: { id: string } }>('/api/access/sessions/:id/kill', async (req, reply) => {
    if (!/^\d{1,10}$/.test(req.params.id)) return reply.code(400).send({ message: 'некорректный id' })
    return act(req, reply, 'session.kill', req.params.id, () => access.helper(['session-kill', req.params.id]))
  })

  app.post<{ Params: { action: string }; Body: { confirm?: string } }>('/api/access/ssh/:action', async (req, reply) => {
    const { action } = req.params
    if (action === 'stop') {
      // Второй рубеж двойного подтверждения: без точной фразы — отказ
      if (req.body?.confirm !== SSH_STOP_PHRASE) {
        audit({ ip: req.clientIp, user: 'admin', action: 'ssh.stop', result: 'denied', details: { reason: 'нет фразы подтверждения' } })
        return reply.code(400).send({ message: `Нужна фраза подтверждения «${SSH_STOP_PHRASE}»` })
      }
      return act(req, reply, 'ssh.stop', null, () => access.helper(['ssh-stop']))
    }
    if (action === 'start') return act(req, reply, 'ssh.start', null, () => access.helper(['ssh-start']))
    return reply.code(400).send({ message: 'недопустимое действие' })
  })
}
