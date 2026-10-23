// Тесты управления из карточек (POST /api/smarthome/ha/toggle) на подставном HA: белый список доменов, неизвестная и скрытая сущность → 403,
// лимит 5/с, актуальное состояние в ответе, журнал без токена. Настоящий HA не вызывается.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJ0ZXN0MTIzNDU2Nzg5MCJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c'
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'sp-toggle-'))
process.env.HA_TOKEN = TOKEN
process.env.HA_URL = 'http://127.0.0.1:8123'

const { default: Fastify } = await import('fastify')
const { default: cookie } = await import('@fastify/cookie')
const { db } = await import('../db.js')
const { smarthomeRoutes, controlDeps } = await import('./smarthome.js')
const { applyHaSync } = await import('../services/smarthomeSync.js')
const { patchDevice, listDevices } = await import('../services/smarthome.js')
const { toggleEntity, buildDevices } = await import('../services/haClient.js')
const { createRateLimiter } = await import('../services/smarthomeControl.js')
const { SESSION_COOKIE } = await import('../auth.js')

const ctl = (entityId: string, name: string, state: string) => ({ entityId, name, state })
const base = { manufacturer: null, model: null, integration: 'sonoff', area: null, available: true, icon: 'socket' as const }
const mk = (id: string, name: string, controls: ReturnType<typeof ctl>[], text = 'включено 0 из 2') =>
  ({ id, name, ...base, summary: { text, tone: 'off' as const, extras: [] }, controls }) as never
applyHaSync(db, [
  mk('d-tx2c', 'TX2C', [ctl('switch.tx2c_balcon', 'Balcon', 'off'), ctl('switch.tx2c_lamp', 'Lamp', 'off')]),
  mk('d-lamp', 'Лампа Tuya', [ctl('light.tuya_lamp', 'Лампа', 'unavailable')], 'недоступно'),
  mk('d-hidden', 'Скрытое', [ctl('switch.hidden', 'Hidden', 'on')], 'включено'),
  mk('d-fan', 'Вентилятор', [], 'доступно'),
])
patchDevice(listDevices().find((d) => d.haDeviceId === 'd-hidden')!.id, { hidden: true })

const calls: string[] = []
let failWith: Error | null = null
const live: Record<string, string> = { 'switch.tx2c_balcon': 'off', 'switch.tx2c_lamp': 'off' }
controlDeps.api = {
  async call(_u, token, domain, action, entityId) {
    assert.equal(token, TOKEN)
    if (failWith) throw failWith
    calls.push(`${domain}/turn_${action} ${entityId}`)
    live[entityId] = action
  },
  async state(_u, _t, entityId) {
    return live[entityId]
  },
}

const app = Fastify()
await app.register(cookie)
app.decorateRequest('clientIp', '')
app.addHook('onRequest', async (req) => void (req.clientIp = '127.0.0.1'))
await app.register(smarthomeRoutes)
const SID = 'test-session'
const now = Date.now()
db.prepare('INSERT INTO sessions (id_hash, created_at, expires_at, last_seen, ip, user_agent, source, second_factor) VALUES (?,?,?,?,?,?,?,?)').run(
  createHash('sha256').update(SID).digest('hex'), now, now + 3_600_000, now, '127.0.0.1', 't', 'external', 1
)
after(() => app.close())

const post = (entity_id: unknown, action: unknown = 'on') =>
  app.inject({ method: 'POST', url: '/api/smarthome/ha/toggle', cookies: { [SESSION_COOKIE]: SID }, payload: { entity_id, action } })

describe('POST /api/smarthome/ha/toggle', () => {
  it('без входа — 401', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/smarthome/ha/toggle', payload: { entity_id: 'switch.tx2c_balcon', action: 'on' } })
    assert.equal(r.statusCode, 401)
  })
  it('switch: включает и возвращает реальное состояние; итог на карточке обновляется', async () => {
    await new Promise((r) => setTimeout(r, 1100)) // свежее окно лимита
    const r = await post('switch.tx2c_balcon', 'on')
    assert.equal(r.statusCode, 200)
    assert.deepEqual(JSON.parse(r.body), { entity_id: 'switch.tx2c_balcon', name: 'Balcon', state: 'on', confirmed: true })
    assert.deepEqual(calls, ['switch/turn_on switch.tx2c_balcon'])
    const d = listDevices().find((x) => x.haDeviceId === 'd-tx2c')!
    assert.equal(d.ha!.summary.text, 'включено 1 из 2')
    assert.equal(d.ha!.controls!.find((c) => c.entityId === 'switch.tx2c_balcon')!.state, 'on')
  })
  it('реальное состояние берётся из HA, а не из запроса', async () => {
    live['switch.tx2c_lamp'] = 'off'
    const orig = controlDeps.api!.call
    controlDeps.api!.call = async () => undefined // HA «не выполнил» команду
    const r = await post('switch.tx2c_lamp', 'on')
    const j = JSON.parse(r.body)
    assert.equal(j.state, 'off')
    assert.equal(j.confirmed, false)
    controlDeps.api!.call = orig
  })
  it('домены вне белого списка → 403 (lock, cover, climate, fan, input_boolean, automation, script)', async () => {
    await new Promise((r) => setTimeout(r, 1100))
    const before = calls.length
    for (const id of ['lock.front_door', 'cover.garage', 'climate.ac', 'fan.vent', 'input_boolean.x', 'automation.a', 'script.s', 'homeassistant.restart']) {
      const r = await post(id)
      assert.equal(r.statusCode, 403, id)
    }
    assert.equal(calls.length, before)
  })
  it('неизвестная и скрытая сущность → 403, HA не вызывается', async () => {
    await new Promise((r) => setTimeout(r, 1100))
    const before = calls.length
    assert.equal((await post('switch.unknown')).statusCode, 403)
    assert.equal((await post('switch.hidden')).statusCode, 403)
    assert.equal(calls.length, before)
  })
  it('некорректное тело → 400', async () => {
    await new Promise((r) => setTimeout(r, 1100))
    assert.equal((await post('switch.tx2c_lamp', 'toggle')).statusCode, 400)
    assert.equal((await post('../../api/config', 'on')).statusCode, 400)
    assert.equal((await post(123)).statusCode, 400)
  })
  it('недоступная сущность → 409', async () => {
    await new Promise((r) => setTimeout(r, 1100))
    assert.equal((await post('light.tuya_lamp')).statusCode, 409)
  })
  it('ошибка HA: понятный текст, токен не утекает ни в ответ, ни в журнал', async () => {
    await new Promise((r) => setTimeout(r, 1100))
    failWith = new Error(`Home Assistant отклонил токен ${TOKEN}`)
    const r = await post('switch.tx2c_lamp', 'on')
    failWith = null
    assert.equal(r.statusCode, 502)
    assert.ok(!r.body.includes('eyJhbGci') && !r.body.includes(TOKEN.slice(20, 50)))
    const rows = db.prepare("SELECT target, details, result FROM audit_log WHERE action = 'smarthome.ha.toggle' ORDER BY id").all() as { target: string; details: string; result: string }[]
    assert.ok(rows.length >= 5)
    assert.ok(!JSON.stringify(rows).includes(TOKEN.slice(20, 50)))
    const ok = rows.find((x) => x.result === 'ok')!
    assert.equal(ok.target, 'switch.tx2c_balcon')
    assert.match(ok.details, /"device":"TX2C"/)
    assert.ok(rows.some((x) => x.result === 'error'))
    assert.ok(rows.some((x) => x.result === 'denied'))
  })
  it('лимит: не больше 5 переключений в секунду', async () => {
    await new Promise((r) => setTimeout(r, 1100))
    const codes: number[] = []
    for (let i = 0; i < 7; i++) codes.push((await post(i % 2 ? 'switch.tx2c_lamp' : 'switch.tx2c_balcon', i % 2 ? 'on' : 'off')).statusCode)
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429])
  })
})

describe('toggleEntity и вспомогательные части', () => {
  it('домен проверяется ещё раз в клиенте HA', async () => {
    for (const id of ['lock.door', 'cover.a', 'switch.a/../../x', 'switch']) await assert.rejects(toggleEntity({ url: 'x', token: 't', entityId: id, action: 'on', api: controlDeps.api }))
    await assert.rejects(toggleEntity({ url: 'x', token: '', entityId: 'switch.a', action: 'on' }), /Токен/)
  })
  it('в данных устройства только switch и light; unavailable — недоступное', () => {
    const raw = {
      areas: [],
      devices: [{ id: 'd1', name: 'TX2C', manufacturer: null, model: null, area_id: null }],
      entities: ['switch.tx2c_balcon', 'switch.tx2c_lamp', 'fan.tx2c_f', 'sensor.tx2c_t', 'light.tx2c_l'].map((e) => ({ entity_id: e, device_id: 'd1', platform: 'sonoff' })),
      states: [
        { entity_id: 'switch.tx2c_balcon', state: 'on', attributes: { friendly_name: 'TX2C Balcon' } },
        { entity_id: 'switch.tx2c_lamp', state: 'off', attributes: { friendly_name: 'TX2C Lamp' } },
        { entity_id: 'fan.tx2c_f', state: 'on', attributes: {} },
        { entity_id: 'sensor.tx2c_t', state: '20', attributes: {} },
        { entity_id: 'light.tx2c_l', state: 'unavailable', attributes: { friendly_name: 'Лампа' } },
      ],
    }
    const [d] = buildDevices(raw)
    assert.deepEqual(d.controls, [
      { entityId: 'light.tx2c_l', name: 'Лампа', state: 'unavailable' },
      { entityId: 'switch.tx2c_balcon', name: 'Balcon', state: 'on' },
      { entityId: 'switch.tx2c_lamp', name: 'Lamp', state: 'off' },
    ])
  })
  it('скользящее окно лимитера', () => {
    let t = 0
    const l = createRateLimiter(2, 1000, () => t)
    assert.deepEqual([l.take(), l.take(), l.take()], [true, true, false])
    t = 1000
    assert.equal(l.take(), true)
  })
})

describe('REST-вызов на локальном подставном HA', async () => {
  const { createServer } = await import('node:http')
  const { liveControlApi } = await import('../services/haClient.js')
  const seen: { req: string; auth: string | undefined; body: string }[] = []
  const srv = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen.push({ req: `${req.method} ${req.url}`, auth: req.headers.authorization, body })
      if (req.headers.authorization !== 'Bearer good') return void res.writeHead(401).end('{}')
      if (req.url === '/api/states/switch.slow') return
      res.setHeader('content-type', 'application/json')
      res.end(req.method === 'POST' ? '[]' : JSON.stringify({ entity_id: 'switch.a', state: 'on' }))
    })
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}`
  after(() => srv.close())

  it('POST /api/services/<domain>/turn_on с entity_id и Bearer, затем GET /api/states/<id>', async () => {
    const s = await toggleEntity({ url, token: 'good', entityId: 'switch.a', action: 'on' })
    assert.deepEqual(s, { state: 'on', confirmed: true })
    assert.deepEqual(seen.map((x) => x.req), ['POST /api/services/switch/turn_on', 'GET /api/states/switch.a'])
    assert.deepEqual(JSON.parse(seen[0].body), { entity_id: 'switch.a' })
    assert.equal(seen[0].auth, 'Bearer good')
  })
  it('401 — понятный текст', async () => {
    await assert.rejects(toggleEntity({ url, token: 'bad', entityId: 'switch.a', action: 'off' }), /отклонил токен/)
  })
  it('HA недоступен — «Home Assistant недоступен»', async () => {
    await assert.rejects(toggleEntity({ url: 'http://127.0.0.1:9', token: 'good', entityId: 'switch.a', action: 'on' }), /недоступен/)
  })
  it('таймаут 5 с', { timeout: 9000 }, async () => {
    const t0 = Date.now()
    await assert.rejects(liveControlApi.state(url, 'good', 'switch.slow'), /недоступен/)
    assert.ok(Date.now() - t0 < 7000)
  })
})
