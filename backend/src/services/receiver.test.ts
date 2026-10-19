// Тесты управления ресивером на подставном сокете: разбор ответов, белый список, «refused», закрытие сокета, очередь.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { beforeEach, describe, it } from 'node:test'
import * as r from './receiver.js'

type Fake = EventEmitter & { written: string[]; destroyed: boolean; write(d: string): boolean; destroy(): void }
let socks: Fake[] = []
let active = 0
let maxActive = 0
// replies: команда → строки ответа
function mock(replies: Record<string, string>) {
  r.setConnector(async () => {
    const s = new EventEmitter() as Fake
    s.written = []
    s.destroyed = false
    active++
    maxActive = Math.max(maxActive, active)
    s.write = (d: string) => {
      const cmd = d.replace(/\r$/, '')
      s.written.push(cmd)
      const rep = replies[cmd]
      if (rep !== undefined) setTimeout(() => s.emit('data', Buffer.from(rep)), 1)
      return true
    }
    s.destroy = () => {
      if (!s.destroyed) active--
      s.destroyed = true
    }
    socks.push(s)
    return s as never
  })
}
const ON = {
  'PW?': 'PWON\r@PWR:2\r',
  'PSDYNEQ ?': 'PSDYNEQ ON\r@ADE:2\r',
  'PSDYNVOL ?': 'PSDYNVOL MED\r@ADV:3\r',
  'PSREFLEV ?': 'PSREFLEV 0\r@ADA:1\r',
  'PSTONE CTRL ?': 'PSTONE CTRL OFF\r',
  'PSMULTEQ: ?': 'PSMULTEQ:AUDYSSEY\r@EQM:5\r',
}

beforeEach(() => {
  socks = []
  active = 0
  maxActive = 0
  Object.assign(r.timing, { connectMs: 200, firstReplyMs: 20, quietMs: 5, gapCmdMs: 1, gapSessionMs: 1, cacheMs: 5000 })
})

describe('receiver', () => {
  it('parseLines выбрасывает служебные строки @…', () => {
    assert.deepEqual(r.parseLines('PSDYNEQ ON\r@ADE:2\r\r'), ['PSDYNEQ ON'])
  })

  it('читает состояние одним сеансом и закрывает сокет', async () => {
    mock(ON)
    const st = await r.getState(true)
    assert.equal(st.power, 'ON')
    assert.equal(st.dynEq, 'ON')
    assert.equal(st.dynVol, 'MED')
    assert.equal(st.refLev, '0')
    assert.equal(st.tone, 'OFF')
    assert.equal(st.multEq, 'AUDYSSEY')
    assert.equal(socks.length, 1)
    assert.ok(socks[0].destroyed)
    assert.ok(socks[0].written.every((c) => c.endsWith('?')), 'при чтении уходят только запросы')
  })

  it('кэш: второй вызов не открывает соединение', async () => {
    mock(ON)
    await r.getState(true)
    await r.getState()
    assert.equal(socks.length, 1)
  })

  it('в режиме ожидания PS-запросы не шлются', async () => {
    mock({ 'PW?': 'PWSTANDBY\r' })
    const st = await r.getState(true)
    assert.equal(st.power, 'STANDBY')
    assert.equal(st.dynEq, null)
    assert.deepEqual(socks[0].written, ['PW?'])
  })

  it('белый список: чужие параметры и значения отклоняются, сокет не открывается', async () => {
    mock(ON)
    for (const [k, v] of [['dynEq', 'MAYBE'], ['dynVol', 'ON'], ['refLev', '7'], ['tone', '1'], ['power', 'OFF'], ['volume', '50'], ['multEq', 'FLAT'], ['__proto__', 'ON'], ['constructor', 'ON']]) {
      await assert.rejects(() => r.setValue(k, v), (e: r.ReceiverError) => e.code === 'bad')
    }
    assert.equal(socks.length, 0)
  })

  it('validate даёт точные команды', () => {
    assert.equal(r.validate('dynEq', 'ON').command, 'PSDYNEQ ON')
    assert.equal(r.validate('dynVol', 'HEV').command, 'PSDYNVOL HEV')
    assert.equal(r.validate('refLev', '15').command, 'PSREFLEV 15')
    assert.equal(r.validate('tone', 'OFF').command, 'PSTONE CTRL OFF')
  })

  it('запись: PW? → до → команда → после; отдаёт реальное значение с ресивера', async () => {
    mock({ ...ON, 'PSDYNVOL HEV': 'PSDYNVOL HEV\r@ADV:1\r' })
    // после записи ресивер «передумал» и отвечает MED — вернуться должно то, что на ресивере
    const res = await r.setValue('dynVol', 'HEV')
    assert.equal(res.command, 'PSDYNVOL HEV')
    assert.equal(res.before, 'MED')
    assert.equal(res.after, 'MED')
    assert.deepEqual(socks[0].written, ['PW?', 'PSDYNVOL ?', 'PSDYNVOL HEV', 'PSDYNVOL ?'])
    assert.ok(socks.every((s) => s.destroyed))
  })

  it('запись при выключенном ресивере: ошибка standby, команда записи не уходит', async () => {
    mock({ 'PW?': 'PWSTANDBY\r' })
    await assert.rejects(() => r.setValue('dynEq', 'OFF'), (e: r.ReceiverError) => e.code === 'standby')
    assert.deepEqual(socks[0].written, ['PW?'])
    assert.ok(socks[0].destroyed)
  })

  it('Connection refused → busy, без повторов', async () => {
    let calls = 0
    r.setConnector(async () => {
      calls++
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    })
    await assert.rejects(() => r.getState(true), (e: r.ReceiverError) => e.code === 'busy' && /занят/.test(e.message))
    assert.equal(calls, 1)
  })

  it('ошибка сокета посреди сеанса: сокет закрыт', async () => {
    r.setConnector(async () => {
      const s = new EventEmitter() as Fake
      s.destroyed = false
      s.write = () => {
        setTimeout(() => s.emit('error', Object.assign(new Error('x'), { code: 'ECONNRESET' })), 1)
        return true
      }
      s.destroy = () => void (s.destroyed = true)
      socks.push(s)
      return s as never
    })
    await assert.rejects(() => r.getState(true), (e: r.ReceiverError) => e instanceof r.ReceiverError)
    assert.ok(socks[0].destroyed)
  })

  it('сеансы идут строго по одному', async () => {
    mock(ON)
    await Promise.all([r.getState(true), r.getState(true), r.getState(true)])
    assert.equal(socks.length, 3)
    assert.equal(maxActive, 1)
  })
})
