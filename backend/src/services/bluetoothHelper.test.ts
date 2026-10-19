// Тесты вызова Bluetooth-хелпера на подставном sudo: белый список, разбор статуса, маскирование/включение, ошибки, ограничение частоты.
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { ExecError } from '../exec.js'
import * as h from './bluetoothHelper.js'

const real = { ...h.deps }
afterEach(() => Object.assign(h.deps, real))

const status = (o: Record<string, unknown> = {}) =>
  JSON.stringify({ active: false, enabled: 'masked', masked: true, autostart: false, rfkill: { soft: false, hard: false }, adapter: true, ...o })

const fake = (reply: (args: string[]) => string | Error) => {
  const calls: string[][] = []
  h.deps.exists = () => true
  h.deps.run = async (args) => {
    calls.push(args)
    const r = reply(args)
    if (r instanceof Error) throw r
    return r
  }
  return calls
}

describe('call: белый список и аргументы', () => {
  it('на sudo уходит ровно хелпер и одна команда', async () => {
    const calls = fake(() => status())
    await h.call('status')
    await h.setPower(true)
    await h.setPower(false)
    await h.setAutostart(true)
    await h.setAutostart(false)
    assert.deepEqual(calls.map((c) => c.slice(1).join(' ')), ['status', 'on', 'off', 'autostart-on', 'autostart-off'])
    assert.ok(calls.every((c) => c.length === 2 && c[0] === h.HELPER))
  })
  it('чужая команда отклоняется до запуска sudo', async () => {
    const calls = fake(() => status())
    await assert.rejects(h.call('restart; reboot' as never), (e: h.HelperError) => e.status === 400)
    assert.equal(calls.length, 0)
  })
})

describe('parseState', () => {
  it('masked → не автозагрузка', () => {
    const s = h.parseState(status())
    assert.deepEqual([s.active, s.masked, s.autostart, s.adapter], [false, true, false, true])
  })
  it('enabled → автозагрузка включена, не masked', () => {
    const s = h.parseState(status({ active: true, enabled: 'enabled' }))
    assert.deepEqual([s.active, s.masked, s.autostart], [true, false, true])
  })
  it('disabled → автозагрузка выключена', () => assert.equal(h.parseState(status({ enabled: 'disabled' })).autostart, false))
  it('masked-runtime считается masked', () => assert.equal(h.parseState(status({ enabled: 'masked-runtime' })).masked, true))
  it('rfkill: неизвестное → null', () => assert.deepEqual(h.parseState(status({ rfkill: {} })).rfkill, { soft: null, hard: null }))
  it('rfkill: блокировки читаются', () => assert.deepEqual(h.parseState(status({ rfkill: { soft: true, hard: false } })).rfkill, { soft: true, hard: false }))
  it('не JSON и неполный ответ — ошибка', () => {
    assert.throws(() => h.parseState('oops'), (e: h.HelperError) => e.status === 502)
    assert.throws(() => h.parseState('{"active":true}'), (e: h.HelperError) => e.status === 502)
  })
})

describe('call: ошибки', () => {
  it('нет файла хелпера → 503 с инструкцией', async () => {
    h.deps.exists = () => false
    await assert.rejects(h.call('status'), (e: h.HelperError) => e.status === 503 && /install\.sh/.test(e.message))
  })
  it('sudo отказал (нет правила) → 503', async () => {
    fake(() => new ExecError('x', 1, 'sudo: a password is required\n', ''))
    await assert.rejects(h.call('on'), (e: h.HelperError) => e.status === 503 && /хелпер не установлен/.test(e.message))
  })
  it('ошибка systemctl в хелпере → 500 с первой строкой stderr', async () => {
    fake(() => new ExecError('x', 3, 'start bluetooth.service: Failed\nlong\n', ''))
    await assert.rejects(h.call('on'), (e: h.HelperError) => e.status === 500 && e.message === 'start bluetooth.service: Failed')
  })
  it('занято (код 4) → 409', async () => {
    fake(() => new ExecError('x', 4, 'занято: выполняется другая операция с Bluetooth', ''))
    await assert.rejects(h.call('off'), (e: h.HelperError) => e.status === 409)
  })
})

describe('createLimiter: не чаще раза в 3 секунды', () => {
  it('вторая попытка раньше срока отклоняется, после паузы проходит', () => {
    let t = 1000
    const l = h.createLimiter(3000, () => t)
    assert.equal(l.take(), 0)
    l.release()
    t += 1000
    assert.equal(l.take(), 2)
    t += 2000
    assert.equal(l.take(), 0)
  })
  it('пока операция идёт, новая не стартует', () => {
    let t = 0
    const l = h.createLimiter(3000, () => t)
    assert.equal(l.take(), 0)
    t += 10_000
    assert.ok(l.take() > 0)
    l.release()
    assert.equal(l.take(), 0)
  })
})
