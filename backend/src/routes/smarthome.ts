import type { FastifyInstance, FastifyReply } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import { config } from '../config.js'
import { errText } from '../mask.js'
import * as store from '../services/smarthome.js'
import { activateScene, CONTROL_DOMAINS, HaError, SCENE_DOMAIN, toggleEntity, type HaControlApi } from '../services/haClient.js'
import { validateScenePatch } from '../services/smarthomeScenes.js'
import { createRateLimiter } from '../services/smarthomeControl.js'
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

// Не больше 5 переключений в секунду на всю панель
const controlLimiter = createRateLimiter(5, 1000)
// Одна и та же сцена — не чаще раза в 300 мс (можно быстро жать «громкость −10»)
const sceneGap = new Map<string, number>()
const SCENE_GAP_MS = 300
export const controlDeps: { api?: HaControlApi } = {}

export async function smarthomeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  // Список: ручные устройства (проверка доступности) и устройства Home Assistant (из реестра, только чтение), блоки, состояние HA
  app.get('/api/smarthome/devices', async () => {
    store.maybeSyncHa()
    return { ...store.listView(), scenes: store.listScenes(), ha: store.haPublic(), now: Date.now() }
  })

  // «Обновить»: перечитать HA сейчас (только чтение)
  app.post('/api/smarthome/ha/sync', async (req) => {
    await store.forceSyncHa()
    audit({ ip: req.clientIp, user: 'admin', action: 'smarthome.ha.sync', details: { status: store.haState.status }, result: store.haState.status === 'ok' ? 'ok' : 'error' })
    return { ...store.listView(), scenes: store.listScenes(), ha: store.haPublic(), now: Date.now() }
  })

  // Включить/выключить сущность switch или light. Только домены из белого списка и только сущности синхронизированных, не скрытых устройств HA.
  app.post<{ Body: { entity_id: string; action: 'on' | 'off' } }>(
    '/api/smarthome/ha/toggle',
    {
      schema: {
        body: {
          type: 'object',
          required: ['entity_id', 'action'],
          additionalProperties: false,
          properties: { entity_id: { type: 'string', maxLength: 120 }, action: { type: 'string', enum: ['on', 'off'] } },
        },
      },
    },
    async (req, reply) => {
      const { entity_id: entityId, action } = req.body
      const deny = (code: number, message: string, result: 'denied' | 'error' = 'denied') => {
        audit({ ip: req.clientIp, user: 'admin', action: 'smarthome.ha.toggle', target: entityId.slice(0, 120), details: { action, reason: message }, result })
        return reply.code(code).send({ message })
      }
      if (!/^[a-z_]+\.[a-z0-9_]+$/.test(entityId)) return deny(400, 'Некорректный идентификатор сущности')
      if (!(CONTROL_DOMAINS as readonly string[]).includes(entityId.split('.')[0])) return deny(403, 'Эту сущность нельзя включать и выключать из панели')
      const found = store.findControl(entityId)
      if (!found) return deny(403, 'Сущность не найдена среди устройств панели (или устройство скрыто)')
      if (!config.ha.token) return deny(409, 'Токен Home Assistant не задан', 'error')
      if (found.control.state === 'unavailable') return deny(409, 'Устройство недоступно', 'error')
      if (!controlLimiter.take()) return deny(429, 'Слишком часто: не больше 5 переключений в секунду', 'error')

      const base = { entityId, device: found.device.name, action, from: found.control.state }
      try {
        const { state, confirmed } = await toggleEntity({ url: config.ha.url, token: config.ha.token, entityId, action, api: controlDeps.api })
        store.setControlState(found.device.id, entityId, state)
        audit({ ip: req.clientIp, user: 'admin', action: 'smarthome.ha.toggle', target: entityId, details: { ...base, to: state, confirmed }, result: 'ok' })
        return { entity_id: entityId, name: found.control.name, state, confirmed }
      } catch (e) {
        const message = errText(e).split('\n')[0] || 'Ошибка Home Assistant'
        audit({ ip: req.clientIp, user: 'admin', action: 'smarthome.ha.toggle', target: entityId, details: { ...base, error: message }, result: 'error' })
        return reply.code(e instanceof HaError && e.status === 'unavailable' ? 503 : 502).send({ message })
      }
    }
  )

  // Запуск сцены (scene.turn_on). Только домен scene и только сцены из реестра панели, не скрытые.
  app.post<{ Body: { entity_id: string } }>(
    '/api/smarthome/ha/scene',
    { schema: { body: { type: 'object', required: ['entity_id'], additionalProperties: false, properties: { entity_id: { type: 'string', maxLength: 120 } } } } },
    async (req, reply) => {
      const entityId = req.body.entity_id
      const deny = (code: number, message: string, result: 'denied' | 'error' = 'denied') => {
        audit({ ip: req.clientIp, user: 'admin', action: 'smarthome.ha.scene', target: entityId.slice(0, 120), details: { reason: message }, result })
        return reply.code(code).send({ message })
      }
      if (!/^[a-z_]+\.[a-z0-9_]+$/.test(entityId)) return deny(400, 'Некорректный идентификатор сущности')
      if (entityId.split('.')[0] !== SCENE_DOMAIN) return deny(403, 'Это не сцена')
      const scene = store.findScene(entityId)
      if (!scene) return deny(403, 'Сцена не найдена среди сцен панели (или скрыта)')
      if (!config.ha.token) return deny(409, 'Токен Home Assistant не задан', 'error')
      if (!scene.available) return deny(409, 'Сцена недоступна', 'error')
      const t = Date.now()
      if (t - (sceneGap.get(entityId) ?? 0) < SCENE_GAP_MS) return deny(429, 'Эта сцена только что запускалась', 'error')
      if (!controlLimiter.take()) return deny(429, 'Слишком часто: не больше 5 вызовов в секунду', 'error')
      sceneGap.set(entityId, t)
      try {
        await activateScene({ url: config.ha.url, token: config.ha.token, entityId, api: controlDeps.api })
        audit({ ip: req.clientIp, user: 'admin', action: 'smarthome.ha.scene', target: entityId, details: { scene: scene.name }, result: 'ok' })
        return { entity_id: entityId, name: scene.name, ok: true }
      } catch (e) {
        const message = errText(e).split('\n')[0] || 'Ошибка Home Assistant'
        audit({ ip: req.clientIp, user: 'admin', action: 'smarthome.ha.scene', target: entityId, details: { scene: scene.name, error: message }, result: 'error' })
        return reply.code(e instanceof HaError && e.status === 'unavailable' ? 503 : 502).send({ message })
      }
    }
  )

  // Настройки плитки сцены: имя, цвет, значок, скрытие (null — вернуть значение по умолчанию)
  app.patch<{ Body: { entity_id: string } }>(
    '/api/smarthome/scenes',
    { schema: { body: { type: 'object', required: ['entity_id'], properties: { entity_id: { type: 'string', pattern: '^scene\\.[a-z0-9_]{1,100}$' } } } } },
    async (req, reply) => {
      const { entity_id: entityId, ...rest } = req.body as { entity_id: string } & Record<string, unknown>
      const v = validateScenePatch(rest)
      if (!v.ok) return reply.code(400).send({ message: v.message, field: v.field })
      const before = store.listScenes().find((s) => s.entityId === entityId)
      const scene = store.patchScene(entityId, v.value)
      if (!scene) return reply.code(404).send({ message: 'Сцена не найдена' })
      audit({ ip: req.clientIp, user: 'admin', action: 'smarthome.scene.update', target: entityId, details: { from: before && { name: before.name, color: before.color, icon: before.icon, hidden: before.hidden }, to: v.value }, result: 'ok' })
      return scene
    }
  )

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
