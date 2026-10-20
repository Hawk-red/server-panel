// Тесты «Быстрых сцен» на подставном HA: только scene.turn_on, 403 для неизвестной/скрытой/чужого домена, лимиты (300 мс на сцену, 5/с всего),
// маскирование токена, синхронизация не затирает имя/цвет/порядок. Настоящие сцены не запускаются.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJ0ZXN0MTIzNDU2Nzg5MCJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c'
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'sp-scene-'))
process.env.HA_TOKEN = TOKEN
process.env.HA_URL = 'http://127.0.0.1:8123'

const { default: Fastify } = await import('fastify')
const { default: cookie } = await import('@fastify/cookie')
const { db } = await import('../db.js')
const { smarthomeRoutes, controlDeps } = await import('./smarthome.js')
const { applySceneSync } = await import('../services/smarthomeSync.js')
const { listScenes, patchScene } = await import('../services/smarthome.js')
const { buildScenes, activateScene, liveControlApi } = await import('../services/haClient.js')
const sc = await import('../services/smarthomeScenes.js')
const { SESSION_COOKIE } = await import('../auth.js')

const NAMES: Record<string, string> = {
  'scene.tv_on': 'TV ON', 'scene.o_f_f': 'O F F', 'scene.mode': '🎥 MODE', 'scene.fire': 'FIRE 🔥', 'scene.r_a_d_i_o': 'R A D I O', 'scene.macbook': 'MACBOOK 🍏',
  'scene.ps4_pro': 'PS4 Pro ⚽️', 'scene.android': 'ANDROID', 'scene.m_a_c_m_i_n_i': 'M A C  M I N I  🍏', 'scene.tv': 'TV 🔆 ⬆️', 'scene.10': '🔊 - 10', 'scene.tv_2': 'TV 🔆 ⬇️', 'scene.led_5': 'LED  ⬇️ -5',
}
// HA отдаёт их в произвольном порядке
const ids = Object.keys(NAMES).reverse()
const haScenes = (extra: { entityId: string; name: string; available: boolean }[] = []) => [...ids.map((entityId) => ({ entityId, name: NAMES[entityId], available: true })), ...extra]
applySceneSync(db, haScenes([{ entityId: 'scene.dead', name: 'Dead', available: false }, { entityId: 'scene.secret', name: 'Secret', available: true }]))
patchScene('scene.secret', { hidden: true })

const calls: string[] = []
let failWith: Error | null = null
controlDeps.api = {
  async call(_u, token, domain, action, entityId) {
    assert.equal(token, TOKEN)
    if (failWith) throw failWith
    calls.push(`${domain}/turn_${action} ${entityId}`)
  },
  async state() {
    return 'off'
  },
}

const app = Fastify()
await app.register(cookie)
app.decorateRequest('clientIp', '')
app.addHook('onRequest', async (req) => void (req.clientIp = '127.0.0.1'))
await app.register(smarthomeRoutes)
const SID = 'scene-session'
const now = Date.now()
db.prepare('INSERT INTO sessions (id_hash, created_at, expires_at, last_seen, ip, user_agent, source, second_factor) VALUES (?,?,?,?,?,?,?,?)').run(
  createHash('sha256').update(SID).digest('hex'), now, now + 3_600_000, now, '127.0.0.1', 't', 'external', 1
)
after(() => app.close())
const cookies = { [SESSION_COOKIE]: SID }
const run = (entity_id: unknown) => app.inject({ method: 'POST', url: '/api/smarthome/ha/scene', cookies, payload: { entity_id } })
const patch = (payload: unknown) => app.inject({ method: 'PATCH', url: '/api/smarthome/scenes', cookies, payload: payload as object })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('имя, цвет, порядок по умолчанию', () => {
  it('буквы через пробел склеиваются, остальные имена без изменений', () => {
    assert.equal(sc.displayName('O F F'), 'OFF')
    assert.equal(sc.displayName('R A D I O'), 'RADIO')
    assert.equal(sc.displayName('M A C  M I N I  🍏'), 'MAC MINI 🍏')
    for (const n of ['TV ON', '🎥 MODE', 'FIRE 🔥', 'MACBOOK 🍏', 'PS4 Pro ⚽️', 'TV 🔆 ⬆️', '🔊 - 10', 'LED  ⬇️ -5']) assert.equal(sc.displayName(n), n)
  })
  it('цвета первых восьми как на виджете, остальные нейтральные', () => {
    const color = (id: string) => listScenes().find((s) => s.entityId === id)!.color
    assert.deepEqual(['tv_on', 'o_f_f', 'mode', 'fire', 'r_a_d_i_o', 'macbook', 'ps4_pro', 'android'].map((x) => color(`scene.${x}`)), ['green', 'red', 'magenta', 'blue', 'brown', 'emerald', 'violet', 'orange'])
    for (const x of ['m_a_c_m_i_n_i', 'tv', '10', 'tv_2', 'led_5', 'dead']) assert.equal(color(`scene.${x}`), 'slate', x)
  })
  it('неизвестная сцена с именем OFF / ВЫКЛ — красная', () => {
    assert.equal(sc.defaultColor('scene.x', 'off'), 'red')
    assert.equal(sc.defaultColor('scene.x', 'Выкл свет'), 'red')
    assert.equal(sc.defaultColor('scene.x', 'Офис'), 'slate')
  })
  it('порядок по умолчанию; новые сцены — в конец', () => {
    assert.deepEqual(listScenes().map((s) => s.entityId), [...sc.DEFAULT_SCENE_ORDER, 'scene.dead', 'scene.secret'])
  })
  it('отображаемые имена и id блоков', () => {
    const s = listScenes()
    assert.equal(s.find((x) => x.entityId === 'scene.m_a_c_m_i_n_i')!.name, 'MAC MINI 🍏')
    assert.equal(s.find((x) => x.entityId === 'scene.m_a_c_m_i_n_i')!.haName, 'M A C  M I N I  🍏')
    for (const x of s) assert.match(x.id, /^[a-z0-9-]{1,40}$/)
    assert.equal(new Set(s.map((x) => x.id)).size, s.length)
    assert.equal(sc.SCENE_COLORS.length, 10)
    assert.ok(sc.SCENE_ICONS.length >= 12)
  })
})

describe('синхронизация сцен', () => {
  it('имя, цвет, значок владельца не затираются; имя из HA обновляется; пропавшие помечаются; скрытое остаётся скрытым', () => {
    patchScene('scene.tv_on', { name: 'Телевизор', color: 'cyan', icon: 'monitor' })
    const next = haScenes().map((s) => (s.entityId === 'scene.tv_on' ? { ...s, name: 'TV ON (новое имя)' } : s)).filter((s) => s.entityId !== 'scene.led_5')
    next.push({ entityId: 'scene.new_one', name: 'Новая', available: true })
    const r = applySceneSync(db, next)
    assert.deepEqual(r, { added: 1, missing: 3 }) // dead, secret и led_5 в этот раз не пришли
    const s = listScenes()
    const tv = s.find((x) => x.entityId === 'scene.tv_on')!
    assert.deepEqual([tv.name, tv.color, tv.icon, tv.haName], ['Телевизор', 'cyan', 'monitor', 'TV ON (новое имя)'])
    assert.equal(s.find((x) => x.entityId === 'scene.led_5')!.missing, true) // не удалена
    assert.equal(s.find((x) => x.entityId === 'scene.new_one')!.hidden, false)
    assert.equal(s.at(-1)!.entityId, 'scene.new_one')
    assert.equal(s.find((x) => x.entityId === 'scene.secret')!.hidden, true)
    // вернулась — снова на месте; повторное имя владельца сбрасывается только по null
    applySceneSync(db, haScenes())
    assert.equal(listScenes().find((x) => x.entityId === 'scene.led_5')!.missing, false)
    patchScene('scene.tv_on', { name: null, color: null, icon: null })
    const back = listScenes().find((x) => x.entityId === 'scene.tv_on')!
    assert.deepEqual([back.name, back.color, back.icon], ['TV ON', 'green', 'tv'])
  })
  it('buildScenes берёт scene.* из состояний и пропускает отключённые/скрытые в реестре', () => {
    const raw = {
      devices: [], areas: [],
      entities: [{ entity_id: 'scene.off_one', disabled_by: 'user' }, { entity_id: 'scene.hid', hidden_by: 'user' }],
      states: [
        { entity_id: 'scene.a', state: '2026-10-20T10:00:00+00:00', attributes: { friendly_name: 'A' } }, { entity_id: 'scene.off_one', state: 'unknown', attributes: {} },
        { entity_id: 'scene.hid', state: 'unknown', attributes: {} }, { entity_id: 'scene.u', state: 'unavailable', attributes: { friendly_name: 'U' } }, { entity_id: 'light.x', state: 'on', attributes: {} },
      ],
    }
    assert.deepEqual(buildScenes(raw), [{ entityId: 'scene.a', name: 'A', available: true }, { entityId: 'scene.u', name: 'U', available: false }])
  })
})

describe('POST /api/smarthome/ha/scene', () => {
  it('без входа — 401', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/smarthome/ha/scene', payload: { entity_id: 'scene.tv_on' } })
    assert.equal(r.statusCode, 401)
  })
  it('запускает scene.turn_on и только его', async () => {
    await wait(1100)
    const r = await run('scene.tv_on')
    assert.equal(r.statusCode, 200)
    assert.deepEqual(JSON.parse(r.body), { entity_id: 'scene.tv_on', name: 'TV ON', ok: true })
    assert.deepEqual(calls, ['scene/turn_on scene.tv_on'])
  })
  it('чужие домены, неизвестная и скрытая сцена → 403; кривое тело → 400; пропавшая → 403', async () => {
    await wait(1100)
    const before = calls.length
    for (const id of ['switch.tx2c_lamp', 'light.x', 'lock.door', 'script.s', 'automation.a']) assert.equal((await run(id)).statusCode, 403, id)
    assert.equal((await run('scene.unknown')).statusCode, 403)
    assert.equal((await run('scene.secret')).statusCode, 403)
    assert.equal((await run('scene.led_5')).statusCode, 200) // вернулась после синхронизации
    assert.equal((await run('../x')).statusCode, 400)
    assert.equal((await run(5)).statusCode, 400)
    assert.equal(calls.length, before + 1)
    patchScene('scene.fire', { hidden: true })
    await wait(1100)
    assert.equal((await run('scene.fire')).statusCode, 403)
    patchScene('scene.fire', { hidden: false })
  })
  it('маршрут переключателей не принимает сцены', async () => {
    await wait(1100)
    const r = await app.inject({ method: 'POST', url: '/api/smarthome/ha/toggle', cookies, payload: { entity_id: 'scene.tv_on', action: 'off' } })
    assert.equal(r.statusCode, 403)
  })
  it('недоступная сцена → 409', async () => {
    await wait(1100)
    applySceneSync(db, [...haScenes(), { entityId: 'scene.dead', name: 'Dead', available: false }])
    assert.equal((await run('scene.dead')).statusCode, 409)
  })
  it('одна и та же сцена — не чаще раза в 300 мс', async () => {
    await wait(1100)
    const a = await run('scene.mode')
    const b = await run('scene.mode')
    await wait(350)
    const c = await run('scene.mode')
    assert.deepEqual([a.statusCode, b.statusCode, c.statusCode], [200, 429, 200])
  })
  it('общий лимит 5 вызовов в секунду', async () => {
    await wait(1100)
    const codes: number[] = []
    for (const id of ['tv_on', 'o_f_f', 'mode', 'fire', 'r_a_d_i_o', 'macbook', 'ps4_pro']) codes.push((await run(`scene.${id}`)).statusCode)
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429])
  })
  it('ошибка HA: русский текст, токен не утекает в ответ и журнал; журнал с именем сцены', async () => {
    await wait(1100)
    failWith = new Error(`Home Assistant отклонил токен ${TOKEN}`)
    const r = await run('scene.android')
    failWith = null
    assert.equal(r.statusCode, 502)
    assert.ok(!r.body.includes('eyJhbGci') && !r.body.includes(TOKEN.slice(20, 50)))
    const rows = db.prepare("SELECT target, details, result FROM audit_log WHERE action = 'smarthome.ha.scene'").all() as { target: string; details: string; result: string }[]
    assert.ok(!JSON.stringify(rows).includes(TOKEN.slice(20, 50)))
    assert.ok(rows.some((x) => x.result === 'ok' && x.target === 'scene.tv_on' && x.details.includes('TV ON')))
    assert.ok(rows.some((x) => x.result === 'error') && rows.some((x) => x.result === 'denied'))
  })
})

describe('PATCH /api/smarthome/scenes', () => {
  it('имя, цвет, значок, скрытие', async () => {
    const r = await patch({ entity_id: 'scene.android', name: '  Андроид  ', color: 'cyan', icon: 'sparkles', hidden: true })
    assert.equal(r.statusCode, 200)
    const s = JSON.parse(r.body)
    assert.deepEqual([s.name, s.color, s.icon, s.hidden], ['Андроид', 'cyan', 'sparkles', true])
    await patch({ entity_id: 'scene.android', hidden: false })
  })
  it('некорректное → 400, неизвестная сцена → 404', async () => {
    assert.equal((await patch({ entity_id: 'scene.android', color: 'pink' })).statusCode, 400)
    assert.equal((await patch({ entity_id: 'scene.android', icon: 'bomb' })).statusCode, 400)
    assert.equal((await patch({ entity_id: 'scene.android', name: '' })).statusCode, 400)
    assert.equal((await patch({ entity_id: 'light.x', hidden: true })).statusCode, 400)
    assert.equal((await patch({ entity_id: 'scene.nope', hidden: true })).statusCode, 404)
  })
  it('список отдаёт сцены вместе с устройствами', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/smarthome/devices', cookies })
    assert.ok(Array.isArray(JSON.parse(r.body).scenes))
  })
})

describe('клиент HA: сцены', () => {
  it('activateScene — только scene; liveControlApi.call не пропускает scene/off и другие домены', async () => {
    await assert.rejects(activateScene({ url: 'x', token: 't', entityId: 'switch.a', api: controlDeps.api }), /не сцена/)
    await assert.rejects(activateScene({ url: 'x', token: '', entityId: 'scene.a' }), /Токен/)
    await assert.rejects(liveControlApi.call('http://127.0.0.1:9', 't', 'scene', 'off', 'scene.a'), /нельзя/)
    await assert.rejects(liveControlApi.call('http://127.0.0.1:9', 't', 'lock', 'on', 'lock.a'), /нельзя/)
  })
})
