// Живое обновление состояний Home Assistant: кэш сразу после toggle, повторное чтение до подтверждения, событие state_changed, откат на опрос при обрыве.
// Настоящий HA и настоящий WebSocket не используются.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJsaXZlMTIzNDU2Nzg5MCJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c'
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'sp-live-'))
process.env.HA_TOKEN = TOKEN
process.env.HA_URL = 'http://127.0.0.1:8123'

const { db } = await import('../db.js')
const { applyHaSync, applySceneSync } = await import('./smarthomeSync.js')
const { listDevices, listScenes, onLiveEvent, applyLiveState, syncHa, haState } = await import('./smarthome.js')
const { toggleEntity } = await import('./haClient.js')
const { parseStateChanged, startHaLive, nextBackoff, BACKOFF_MAX_MS } = await import('./haLive.js')

const ctl = (entityId: string, name: string, state: string) => ({ entityId, name, state })
const base = { manufacturer: null, model: null, integration: 'sonoff', area: null, available: true, icon: 'socket' as const }
applyHaSync(db, [{ id: 'd1', name: 'TX2C', ...base, summary: { text: 'включено 0 из 2', tone: 'off', extras: [] }, controls: [ctl('switch.a', 'A', 'off'), ctl('switch.b', 'B', 'off')] } as never])
applySceneSync(db, [{ entityId: 'scene.tv', name: 'TV', available: true }])
const stateOf = (id: string) => listDevices()[0].ha!.controls!.find((c) => c.entityId === id)!.state

describe('toggleEntity: подтверждение состояния', () => {
  const mkApi = (reads: string[]) => {
    const log: string[] = []
    return {
      log,
      api: {
        async call(_u: string, _t: string, d: string, a: string, e: string) {
          log.push(`call ${d}/${a} ${e}`)
        },
        async state() {
          log.push('state')
          return reads.shift() ?? 'off'
        },
      },
    }
  }
  const pauses: number[] = []
  const sleep = async (ms: number) => void pauses.push(ms)
  it('сразу подтверждено — одно чтение, без пауз', async () => {
    pauses.length = 0
    const { api, log } = mkApi(['on'])
    assert.deepEqual(await toggleEntity({ url: 'x', token: 't', entityId: 'switch.a', action: 'on', api, sleep }), { state: 'on', confirmed: true })
    assert.deepEqual(log, ['call switch/on switch.a', 'state'])
    assert.deepEqual(pauses, [])
  })
  it('медленное устройство: повторное чтение с паузой 700 мс, пока не совпадёт', async () => {
    pauses.length = 0
    const { api, log } = mkApi(['off', 'on'])
    assert.deepEqual(await toggleEntity({ url: 'x', token: 't', entityId: 'switch.a', action: 'on', api, sleep }), { state: 'on', confirmed: true })
    assert.equal(log.filter((x) => x === 'state').length, 2)
    assert.deepEqual(pauses, [700])
  })
  it('не подтвердилось: ровно 2 повтора, confirmed=false и реальное состояние', async () => {
    pauses.length = 0
    const { api, log } = mkApi(['off', 'off', 'off', 'off'])
    assert.deepEqual(await toggleEntity({ url: 'x', token: 't', entityId: 'switch.a', action: 'on', api, sleep }), { state: 'off', confirmed: false })
    assert.equal(log.filter((x) => x === 'state').length, 3)
    assert.deepEqual(pauses, [700, 700])
  })
})

describe('кэш панели и событие state_changed', () => {
  it('событие switch меняет тумблер и итог карточки сразу', () => {
    onLiveEvent({ entityId: 'switch.a', state: 'on' })
    assert.equal(stateOf('switch.a'), 'on')
    assert.equal(listDevices()[0].ha!.summary.text, 'включено 1 из 2')
    onLiveEvent({ entityId: 'switch.a', state: 'off' })
    assert.equal(listDevices()[0].ha!.summary.text, 'включено 0 из 2')
  })
  it('unavailable/unknown → unavailable; повтор того же состояния ничего не пишет', () => {
    assert.equal(applyLiveState('switch.b', 'unavailable'), true)
    assert.equal(stateOf('switch.b'), 'unavailable')
    assert.equal(applyLiveState('switch.b', 'unavailable'), false)
    applyLiveState('switch.b', 'off')
  })
  it('сцена: только доступность', () => {
    onLiveEvent({ entityId: 'scene.tv', state: 'unavailable' })
    assert.equal(listScenes()[0].available, false)
    onLiveEvent({ entityId: 'scene.tv', state: '2026-10-23T10:00:00+00:00' }) // у сцены состояние — время последнего запуска
    assert.equal(listScenes()[0].available, true)
  })
  it('чужая сущность не создаёт записей', () => {
    assert.equal(applyLiveState('switch.unknown', 'on'), false)
  })
  it('синхронизация, начатая до события, не затирает его устаревшими данными', async () => {
    const stale = { id: 'd1', name: 'TX2C', ...base, summary: { text: 'включено 0 из 2', tone: 'off', extras: [] }, controls: [ctl('switch.a', 'A', 'off'), ctl('switch.b', 'B', 'off')] }
    await syncHa({
      reader: async () => {
        onLiveEvent({ entityId: 'switch.a', state: 'on' }) // событие приходит, пока HA читается
        return { devices: [stale as never], scenes: [] }
      },
    })
    assert.equal(stateOf('switch.a'), 'on')
    assert.equal(listDevices()[0].ha!.summary.text, 'включено 1 из 2')
    assert.equal(haState.status, 'ok')
  })
})

describe('разбор событий', () => {
  const ev = (entity_id: string, state: string | null) => ({ type: 'event', event: { event_type: 'state_changed', data: { entity_id, new_state: state === null ? null : { state } } } })
  it('берутся только switch/light/scene', () => {
    assert.deepEqual(parseStateChanged(ev('light.x', 'on')), { entityId: 'light.x', state: 'on' })
    assert.deepEqual(parseStateChanged(ev('scene.x', 'unavailable')), { entityId: 'scene.x', state: 'unavailable' })
    for (const id of ['sensor.t', 'lock.door', 'climate.ac', 'automation.a']) assert.equal(parseStateChanged(ev(id, 'on')), null)
  })
  it('мусор, удаление сущности и чужие типы — null', () => {
    assert.equal(parseStateChanged(ev('switch.a', null)), null)
    assert.equal(parseStateChanged({ type: 'result' }), null)
    assert.equal(parseStateChanged(null), null)
    assert.equal(parseStateChanged({ type: 'event', event: { event_type: 'other' } }), null)
  })
})

describe('WebSocket: подписка, обрыв, повтор', () => {
  class FakeWs extends EventEmitter {
    sent: Record<string, unknown>[] = []
    closed = false
    send(s: string) {
      this.sent.push(JSON.parse(s))
    }
    close() {
      this.closed = true
    }
  }
  const setup = () => {
    const socks: FakeWs[] = []
    const timers: { fn: () => void; ms: number }[] = []
    const events: string[] = []
    const up: boolean[] = []
    const logs: string[] = []
    const h = startHaLive({
      url: 'http://127.0.0.1:8123',
      token: TOKEN,
      onEvent: (e) => events.push(`${e.entityId}=${e.state}`),
      onConnected: (v) => up.push(v),
      log: (m) => logs.push(m),
      connect: () => {
        const w = new FakeWs()
        socks.push(w)
        return w as never
      },
      setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length),
      clearTimer: () => undefined,
    })
    const msg = (w: FakeWs, m: unknown) => w.emit('message', JSON.stringify(m))
    const handshake = (w: FakeWs) => {
      msg(w, { type: 'auth_required' })
      msg(w, { type: 'auth_ok' })
      msg(w, { id: 1, type: 'result', success: true })
    }
    return { h, socks, timers, events, up, logs, msg, handshake }
  }
  it('аутентификация, подписка на state_changed, события доходят', () => {
    const t = setup()
    t.msg(t.socks[0], { type: 'auth_required' })
    assert.deepEqual(t.socks[0].sent[0], { type: 'auth', access_token: TOKEN })
    t.msg(t.socks[0], { type: 'auth_ok' })
    assert.deepEqual(t.socks[0].sent[1], { id: 1, type: 'subscribe_events', event_type: 'state_changed' })
    t.msg(t.socks[0], { id: 1, type: 'result', success: true })
    assert.deepEqual(t.up, [true])
    t.msg(t.socks[0], { type: 'event', id: 1, event: { event_type: 'state_changed', data: { entity_id: 'switch.a', new_state: { state: 'on' } } } })
    t.msg(t.socks[0], { type: 'event', id: 1, event: { event_type: 'state_changed', data: { entity_id: 'sensor.a', new_state: { state: '5' } } } })
    assert.deepEqual(t.events, ['switch.a=on'])
    t.h.stop()
  })
  it('обрыв: сигнал «связи нет» (возврат к опросу), пауза растёт 1→2→4 с, после успеха сбрасывается; токен не в логах', () => {
    const t = setup()
    t.handshake(t.socks[0])
    t.socks[0].emit('close')
    assert.deepEqual(t.up, [true, false])
    assert.deepEqual(t.timers.map((x) => x.ms), [1000])
    t.timers[0].fn() // повтор
    assert.equal(t.socks.length, 2)
    t.socks[1].emit('error', new Error(`ECONNREFUSED ${TOKEN}`))
    t.socks[1].emit('close') // второй сигнал об одном обрыве не плодит таймеров
    assert.deepEqual(t.timers.map((x) => x.ms), [1000, 2000])
    t.timers[1].fn()
    t.socks[2].emit('close')
    assert.deepEqual(t.timers.map((x) => x.ms), [1000, 2000, 4000])
    t.timers[2].fn()
    t.handshake(t.socks[3])
    assert.deepEqual(t.up, [true, false, true])
    t.socks[3].emit('close')
    assert.equal(t.timers[3].ms, 1000)
    assert.ok(!t.logs.join('\n').includes(TOKEN.slice(20, 50)))
    t.h.stop()
  })
  it('отклонённый токен: повторы с паузой, не в цикле без пауз', () => {
    const t = setup()
    t.msg(t.socks[0], { type: 'auth_invalid' })
    assert.equal(t.timers.length, 1)
    assert.equal(t.socks[0].closed, true)
    t.h.stop()
  })
  it('stop() закрывает соединение и больше не переподключается', () => {
    const t = setup()
    t.handshake(t.socks[0])
    t.h.stop()
    assert.equal(t.socks[0].closed, true)
    assert.equal(t.timers.length, 0)
  })
  it('пауза не больше минуты', () => {
    let ms = 1000
    for (let i = 0; i < 20; i++) ms = nextBackoff(ms)
    assert.equal(ms, BACKOFF_MAX_MS)
  })
})
