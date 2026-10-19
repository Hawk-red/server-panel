import type { FastifyInstance, FastifyReply } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import * as store from '../services/smarthome.js'
import { validateGroupName } from '../services/smarthomeGroups.js'
import { assertLocal, MAX_DEVICES, urlHost, parseUrl, validateDevice, type DeviceInput } from '../services/smarthomeCore.js'

const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } } as const
const gidParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' } } } as const

// Проверка тела и адреса (только локальная сеть); при ошибке сама отвечает 400
async function accept(body: unknown, reply: FastifyReply): Promise<DeviceInput | null> {
  const c = validateDevice(body)
  if (!c.ok) {
    reply.code(400).send({ message: c.message, field: c.field })
    return null
  }
  const v = c.value
  const checks: [string, string | null][] = [
    ['host', v.host],
    ['url', v.url ? urlHost(parseUrl(v.url)!) : null],
  ]
  for (const [field, host] of checks) {
    if (!host) continue
    try {
      await assertLocal(host)
    } catch (e) {
      reply.code(400).send({ message: (e as Error).message, field })
      return null
    }
  }
  return v
}

export async function smarthomeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  // Список: ручные устройства (проверка доступности) и устройства Home Assistant (из реестра, только чтение), блоки, состояние HA
  app.get('/api/smarthome/devices', async () => {
    store.maybeSyncHa()
    return { ...store.listView(), ha: store.haPublic(), now: Date.now() }
  })

  // «Обновить»: перечитать HA сейчас (только чтение)
  app.post('/api/smarthome/ha/sync', async (req) => {
    await store.forceSyncHa()
    audit({ ip: req.clientIp, user: 'admin', action: 'smarthome.ha.sync', details: { status: store.haState.status }, result: store.haState.status === 'ok' ? 'ok' : 'error' })
    return { ...store.listView(), ha: store.haPublic(), now: Date.now() }
  })

  app.post('/api/smarthome/devices', async (req, reply) => {
    const v = await accept(req.body, reply)
    if (!v) return
    if (store.countManual() >= MAX_DEVICES) return reply.code(409).send({ message: `Не больше ${MAX_DEVICES} устройств, добавленных вручную` })
    const d = store.createDevice(v)
    audit({ ip: req.clientIp, user: 'admin', action: 'smarthome.device.create', target: d.name, details: { id: d.id, kind: d.kind, room: d.room }, result: 'ok' })
    return reply.code(201).send(d)
  })

  app.put<{ Params: { id: number } }>('/api/smarthome/devices/:id', { schema: { params: idParams } }, async (req, reply) => {
    const before = store.getDevice(req.params.id)
    if (!before) return reply.code(404).send({ message: 'Устройство не найдено' })
    if (before.source !== 'manual') return reply.code(400).send({ message: 'Устройство из Home Assistant: его можно переименовать, переместить или скрыть, но не изменить адрес' })
    const v = await accept(req.body, reply)
    if (!v) return
    const d = store.updateDevice(req.params.id, v)!
    const changed = Object.keys(v).filter((k) => (before as unknown as Record<string, unknown>)[k] !== (v as unknown as Record<string, unknown>)[k])
    audit({ ip: req.clientIp, user: 'admin', action: 'smarthome.device.update', target: d.name, details: { id: d.id, changed }, result: 'ok' })
    return d
  })

  // Выбор владельца: переименовать, переместить в блок, скрыть/показать (устройства Home Assistant и ручные)
  app.patch<{ Params: { id: number }; Body: { name?: string; groupKey?: string | null; hidden?: boolean } }>(
    '/api/smarthome/devices/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { name: { type: 'string' }, groupKey: { type: ['string', 'null'], pattern: '^[a-z0-9-]{1,40}$' }, hidden: { type: 'boolean' } },
        },
      },
    },
    async (req, reply) => {
      const before = store.getDevice(req.params.id)
      if (!before) return reply.code(404).send({ message: 'Устройство не найдено' })
      const p = { ...req.body }
      if (p.name !== undefined) {
        p.name = p.name.trim()
        if (p.name.length < 1 || p.name.length > 60) return reply.code(400).send({ message: 'Название: от 1 до 60 символов', field: 'name' })
      }
      if (typeof p.groupKey === 'string' && !store.currentGroups().some((g) => g.id === p.groupKey)) return reply.code(400).send({ message: 'Такого блока нет', field: 'groupKey' })
      const d = store.patchDevice(req.params.id, p)!
      audit({ ip: req.clientIp, user: 'admin', action: 'smarthome.device.update', target: d.name, details: { id: d.id, from: { name: before.name, groupKey: before.groupKey, hidden: before.hidden }, to: p }, result: 'ok' })
      return d
    }
  )

  app.delete<{ Params: { id: number } }>('/api/smarthome/devices/:id', { schema: { params: idParams } }, async (req, reply) => {
    const before = store.getDevice(req.params.id)
    if (!before) return reply.code(404).send({ message: 'Устройство не найдено' })
    // Устройство из HA удаляется только если его в HA уже нет: иначе оно вернётся при следующей синхронизации (скрыть можно всегда)
    if (before.source === 'homeassistant' && !before.haMissing) return reply.code(409).send({ message: 'Устройство есть в Home Assistant: скройте его вместо удаления' })
    store.deleteDevice(req.params.id)
    audit({ ip: req.clientIp, user: 'admin', action: 'smarthome.device.delete', target: before.name, details: { id: before.id, kind: before.kind, source: before.source }, result: 'ok' })
    return { ok: true }
  })

  // ---------- собственные блоки владельца ----------
  app.post<{ Body: { name: string } }>('/api/smarthome/groups', async (req, reply) => {
    const v = validateGroupName((req.body as { name?: unknown } | undefined)?.name)
    if (!v.ok) return reply.code(400).send({ message: v.message, field: 'name' })
    if (store.customGroups().length >= 20) return reply.code(409).send({ message: 'Не больше 20 собственных блоков' })
    const g = store.addGroup(v.name)
    audit({ ip: req.clientIp, user: 'admin', action: 'smarthome.group.create', target: g.name, details: { id: g.id }, result: 'ok' })
    return reply.code(201).send(g)
  })

  app.put<{ Params: { id: string }; Body: { name: string } }>('/api/smarthome/groups/:id', { schema: { params: gidParams } }, async (req, reply) => {
    const v = validateGroupName((req.body as { name?: unknown } | undefined)?.name)
    if (!v.ok) return reply.code(400).send({ message: v.message, field: 'name' })
    const g = store.renameGroup(req.params.id, v.name)
    if (!g) return reply.code(404).send({ message: 'Блок не найден (переименовать можно только собственные блоки)' })
    audit({ ip: req.clientIp, user: 'admin', action: 'smarthome.group.update', target: g.name, details: { id: g.id }, result: 'ok' })
    return g
  })

  app.delete<{ Params: { id: string } }>('/api/smarthome/groups/:id', { schema: { params: gidParams } }, async (req, reply) => {
    if (!store.removeGroup(req.params.id)) return reply.code(404).send({ message: 'Блок не найден (удалить можно только собственные блоки)' })
    audit({ ip: req.clientIp, user: 'admin', action: 'smarthome.group.delete', target: req.params.id, result: 'ok' })
    return { ok: true }
  })
}
