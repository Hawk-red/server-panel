// UGOOS SK1 напрямую по ADB: подставной adb (настоящий бокс не трогается) — белый список ключей, маппинг на
// keyevent-ы, подключение-подстраховка перед командой, разбор ошибок, кэш статуса.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, before, beforeEach, describe, it } from 'node:test'
import { ExecError } from '../exec.js'

let ugoos: typeof import('./ugoos.js')
let realRun: (typeof import('./ugoos.js'))['deps']['run']

const SERIAL = '192.168.31.6:5555'

before(async () => {
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'ugoos-test-'))
  ugoos = await import('./ugoos.js')
  realRun = ugoos.deps.run
})
afterEach(() => void (ugoos.deps.run = realRun))

type Call = { args: string[] }
function fake(reply: (args: string[]) => string | Error) {
  const calls: Call[] = []
  ugoos.deps.run = async (args) => {
    calls.push({ args })
    const r = reply(args)
    if (r instanceof Error) throw r
    return r
  }
  return calls
}

beforeEach(() => {
  ugoos.resetStatus()
  ugoos.resetConnectCache()
})

describe('белый список ключей UGOOS', () => {
  const WANT = ['POWER', 'HOME', 'BACK', 'MENU', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'DPAD_CENTER', 'VOL_UP', 'VOL_DOWN', 'MUTE']
  it('ровно заданные ключи, все проверены', () => {
    assert.deepEqual(Object.keys(ugoos.KEYS).sort(), [...WANT].sort())
    assert.ok(Object.values(ugoos.KEYS).every((k) => k.verified))
  })
  it('чужие ключи отклоняются без обращения к adb', async () => {
    const calls = fake(() => 'device')
    for (const k of ['KEY_HOME', 'home', '', '__proto__', 'constructor', 'DPAD_UP\nHOME']) {
      await assert.rejects(() => ugoos.sendKey(k), (e: { code?: string }) => e.code === 'bad', JSON.stringify(k))
    }
    assert.equal(calls.length, 0)
  })
  it('повторяемые при удержании ключи — громкость и D-pad', () => {
    assert.deepEqual([...ugoos.QUIET_KEYS].sort(), ['DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'DPAD_UP', 'VOL_DOWN', 'VOL_UP'].sort())
  })
})

describe('отправка клавиш по ADB', () => {
  it('подключение перед первой командой, затем keyevent с нужным кодом', async () => {
    const calls = fake(() => 'device')
    await ugoos.sendKey('HOME')
    await ugoos.sendKey('BACK')
    assert.deepEqual(calls.map((c) => c.args), [
      ['connect', SERIAL],
      ['-s', SERIAL, 'shell', 'input', 'keyevent', 'KEYCODE_HOME'],
      ['-s', SERIAL, 'shell', 'input', 'keyevent', 'KEYCODE_BACK'],
    ])
  })
  it('каждый ключ маппится на свой android keyevent', async () => {
    const want: Record<string, string> = {
      POWER: 'KEYCODE_POWER',
      HOME: 'KEYCODE_HOME',
      BACK: 'KEYCODE_BACK',
      MENU: 'KEYCODE_MENU',
      DPAD_UP: 'KEYCODE_DPAD_UP',
      DPAD_DOWN: 'KEYCODE_DPAD_DOWN',
      DPAD_LEFT: 'KEYCODE_DPAD_LEFT',
      DPAD_RIGHT: 'KEYCODE_DPAD_RIGHT',
      DPAD_CENTER: 'KEYCODE_DPAD_CENTER',
      VOL_UP: 'KEYCODE_VOLUME_UP',
      VOL_DOWN: 'KEYCODE_VOLUME_DOWN',
      MUTE: 'KEYCODE_VOLUME_MUTE',
    }
    for (const [key, code] of Object.entries(want)) {
      ugoos.resetConnectCache()
      const calls = fake(() => 'device')
      const r = await ugoos.sendKey(key)
      assert.deepEqual(calls.at(-1)?.args, ['-s', SERIAL, 'shell', 'input', 'keyevent', code], key)
      assert.match(r.via, new RegExp(code))
    }
  })
  it('adb connect — не чаще раза за окно кэша подряд', async () => {
    const calls = fake(() => 'device')
    await ugoos.sendKey('DPAD_UP')
    await ugoos.sendKey('DPAD_DOWN')
    await ugoos.sendKey('DPAD_LEFT')
    assert.equal(calls.filter((c) => c.args[0] === 'connect').length, 1)
  })
  it('adb connect не удался — всё равно пробуем keyevent (как у ИК-пульта: пусть решает сама попытка)', async () => {
    const calls = fake((args) => (args[0] === 'connect' ? new Error('device offline') : 'device'))
    const r = await ugoos.sendKey('DPAD_CENTER')
    assert.deepEqual(calls.map((c) => c.args), [
      ['connect', SERIAL],
      ['-s', SERIAL, 'shell', 'input', 'keyevent', 'KEYCODE_DPAD_CENTER'],
    ])
    assert.match(r.via, /KEYCODE_DPAD_CENTER/)
  })
  it('сама ADB-команда не выполнилась — понятная ошибка, без падения с левым текстом', async () => {
    fake((args) => (args[0] === 'connect' ? 'connected' : new ExecError('x', 1, 'error: device offline', '')))
    await assert.rejects(() => ugoos.sendKey('HOME'), (e: { code?: string; message: string }) => e.code === 'offline' && /ADB/.test(e.message))
  })
  it('adb не установлен на сервере (ENOENT) — понятная ошибка', async () => {
    fake((args) => (args[0] === 'connect' ? 'connected' : new ExecError('x', 'ENOENT', '', '')))
    await assert.rejects(() => ugoos.sendKey('HOME'), (e: { code?: string; message: string }) => e.code === 'offline' && /adb/.test(e.message))
  })
})

describe('статус', () => {
  it('get-state=device -> online, список ключей — весь белый список', async () => {
    fake(() => 'device\n')
    const s = await ugoos.getStatus(true)
    assert.equal(s.online, true)
    assert.deepEqual(s.keys.sort(), Object.keys(ugoos.KEYS).sort())
  })
  it('get-state не device или ошибка -> offline', async () => {
    fake(() => 'offline\n')
    assert.equal((await ugoos.getStatus(true)).online, false)
    fake(() => new Error('no devices/emulators found'))
    assert.equal((await ugoos.getStatus(true)).online, false)
  })
  it('статус кэшируется, force перечитывает заново', async () => {
    let n = 0
    ugoos.deps.run = async () => {
      n++
      return 'device'
    }
    await ugoos.getStatus(true)
    await ugoos.getStatus() // из кэша, без нового вызова adb
    assert.equal(n, 1)
    await ugoos.getStatus(true)
    assert.equal(n, 2)
  })
  it('проверка статуса не трогает adb connect (это только для отправки команд)', async () => {
    const calls = fake(() => 'device')
    await ugoos.getStatus(true)
    assert.ok(!calls.some((c) => c.args[0] === 'connect'))
  })
})
