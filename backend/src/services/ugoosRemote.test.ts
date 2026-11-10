// Привязки кнопок экранного пульта UGOOS (ugoos.remote): умолчания, назначение, белый список.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, beforeEach, describe, it } from 'node:test'

let ugoos: typeof import('./ugoos.js')
let remote: typeof import('./ugoosRemote.js')
let st: typeof import('../settings.js')

before(async () => {
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'ugoosremote-test-'))
  ugoos = await import('./ugoos.js')
  remote = await import('./ugoosRemote.js')
  st = await import('../settings.js')
})
beforeEach(() => st.setSetting(remote.SETTING_KEY, {}))

describe('привязки ugoos.remote', () => {
  it('умолчания — из белого списка, кроме явно оставленных без команды', () => {
    for (const [b, k] of Object.entries(remote.REMOTE_DEFAULTS)) assert.ok(k === null || ugoos.isKey(k), b)
    const unassigned = ['power2', 'cursor', 'settings', 'mic', 'arrow-up2', 'arrow-down2', 'app-1', 'app-2', 'app-3', 'app-4', 'app-5', 'app-6']
    for (const b of unassigned) assert.equal(remote.REMOTE_DEFAULTS[b], null, b)
    assert.equal(remote.REMOTE_BUTTONS.length, Object.keys(remote.REMOTE_DEFAULTS).length)
  })
  it('назначенные по умолчанию кнопки указывают на правильные команды', () => {
    const want: Record<string, string> = { power: 'POWER', mute: 'MUTE', 'dpad-up': 'DPAD_UP', 'dpad-down': 'DPAD_DOWN', 'dpad-left': 'DPAD_LEFT', 'dpad-right': 'DPAD_RIGHT', ok: 'DPAD_CENTER', back: 'BACK', home: 'HOME', menu: 'MENU', 'vol-up': 'VOL_UP', 'vol-down': 'VOL_DOWN' }
    for (const [b, k] of Object.entries(want)) assert.equal(remote.REMOTE_DEFAULTS[b], k, b)
  })
  it('назначение, null и сброс', () => {
    remote.setBinding('cursor', 'MENU')
    assert.equal(remote.getBindings().cursor, 'MENU')
    remote.setBinding('cursor', null)
    assert.equal(remote.getBindings().cursor, null)
    remote.setBinding('cursor', undefined)
    assert.equal(remote.getBindings().cursor, null) // по умолчанию у cursor и так нет команды
    remote.setBinding('home', 'MENU')
    assert.equal(remote.getBindings().home, 'MENU')
    remote.setBinding('home', undefined)
    assert.equal(remote.getBindings().home, 'HOME')
    assert.deepEqual(st.getSetting(remote.SETTING_KEY, {}), {})
  })
  it('чужие ключи и кнопки отклоняются', () => {
    for (const k of ['KEY_HDMI', '', 'MVUP']) assert.throws(() => remote.setBinding('home', k), (e: { code?: string }) => e.code === 'bad')
    for (const b of ['__proto__', 'nope']) assert.throws(() => remote.setBinding(b, 'MENU'), (e: { code?: string }) => e.code === 'bad')
  })
  it('испорченные записи игнорируются', () => {
    st.setSetting(remote.SETTING_KEY, { home: 'NOT_A_KEY', nope: 'MENU', back: 5, menu: 'HOME' })
    const b = remote.getBindings()
    assert.equal(b.home, 'HOME')
    assert.equal(b.menu, 'HOME')
    assert.ok(!('nope' in b))
  })
  it('каталог команд соответствует белому списку', () => {
    assert.deepEqual(remote.commandCatalog().map((c) => c.command).sort(), Object.keys(ugoos.KEYS).sort())
    assert.ok(remote.commandCatalog().every((c) => c.group === 'Ключи UGOOS'))
  })
})
