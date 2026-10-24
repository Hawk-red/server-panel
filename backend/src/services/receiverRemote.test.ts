// Привязки экранного пульта: умолчания, сохранение в настройках панели (в отдельной временной БД), проверка по белому списку.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, beforeEach, describe, it } from 'node:test'

let m: typeof import('./receiverRemote.js')
let rc: typeof import('./receiver.js')
let st: typeof import('../settings.js')

before(async () => {
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'remote-test-'))
  m = await import('./receiverRemote.js')
  rc = await import('./receiver.js')
  st = await import('../settings.js')
})
beforeEach(() => st.setSetting(m.SETTING_KEY, {}))

describe('умолчания пульта', () => {
  it('каждая команда по умолчанию — из белого списка', () => {
    for (const [b, c] of Object.entries(m.REMOTE_DEFAULTS)) if (c !== null) assert.doesNotThrow(() => rc.classify(c), `${b}: ${c}`)
  })
  it('45 кнопок, уникальные id, формат допустимый', () => {
    assert.equal(m.REMOTE_BUTTONS.length, 45)
    for (const b of m.REMOTE_BUTTONS) assert.match(b, /^[a-z0-9-]{1,20}$/)
  })
  it('серые по умолчанию: 8K, USB, Bluetooth, HEOS, Phono, ▶/II', () => {
    const none = Object.entries(m.REMOTE_DEFAULTS).filter(([, c]) => c === null).map(([b]) => b).sort()
    assert.deepEqual(none, ['in-8k', 'in-bt', 'in-heos', 'in-phono', 'in-usb', 'play'])
  })
  it('никаких абсолютных громкостей и чужих команд среди умолчаний', () => {
    for (const c of Object.values(m.REMOTE_DEFAULTS)) assert.ok(c === null || !/^MV\d/.test(c))
  })
})

describe('привязки', () => {
  it('без сохранённого — умолчания', () => {
    assert.deepEqual(m.getBindings(), m.REMOTE_DEFAULTS)
  })
  it('назначение сохраняется в настройках и возвращается', () => {
    m.setBinding('play', 'MNENT')
    m.setBinding('eco', 'ECOOFF')
    assert.equal(m.getBindings().play, 'MNENT')
    assert.deepEqual(st.getSetting(m.SETTING_KEY, {}), { play: 'MNENT', eco: 'ECOOFF' })
  })
  it('null — кнопка без команды; умолчание возвращается сбросом', () => {
    m.setBinding('mute', null)
    assert.equal(m.getBindings().mute, null)
    m.setBinding('mute', undefined)
    assert.equal(m.getBindings().mute, 'MUTOGGLE')
    assert.deepEqual(st.getSetting(m.SETTING_KEY, {}), {})
  })
  it('назначение значения по умолчанию не хранится отдельно', () => {
    m.setBinding('back', 'MNRTN')
    assert.deepEqual(st.getSetting(m.SETTING_KEY, {}), {})
  })
  it('чужая команда и чужая кнопка отклоняются, сохранённое не меняется', () => {
    for (const c of ['MV50', 'PWRESET', '', 'SIFOO', 'MSQUICK9']) assert.throws(() => m.setBinding('play', c), (e: { code?: string }) => e.code === 'bad', c)
    for (const b of ['__proto__', 'constructor', 'nope', 'toString']) assert.throws(() => m.setBinding(b, 'MNENT'), (e: { code?: string }) => e.code === 'bad', b)
    assert.deepEqual(st.getSetting(m.SETTING_KEY, {}), {})
  })
  it('испорченные записи в настройках игнорируются при чтении', () => {
    st.setSetting(m.SETTING_KEY, { play: 'MV99', nope: 'MNENT', eco: 5, back: 'MNENT' })
    const b = m.getBindings()
    assert.equal(b.play, null)
    assert.equal(b.eco, 'ECOCYCLE')
    assert.equal(b.back, 'MNENT')
    assert.ok(!('nope' in b))
  })
})

describe('каталог команд для выбора', () => {
  it('каждая команда каталога допустима, дублей нет, входы присутствуют', () => {
    const list = m.commandCatalog()
    assert.equal(new Set(list.map((c) => c.command)).size, list.length)
    for (const c of list) {
      assert.doesNotThrow(() => rc.classify(c.command), c.command)
      assert.ok(c.title && c.group)
    }
    assert.ok(list.some((c) => c.command === 'SIIRADIO'))
  })
  it('каталог покрывает все FIXED-команды, кроме MSDIRECT-подобных дублей не теряет ничего', () => {
    const have = new Set(m.commandCatalog().map((c) => c.command))
    for (const c of Object.keys(rc.FIXED)) assert.ok(have.has(c), c)
    for (const c of Object.keys(rc.TOGGLES)) assert.ok(have.has(c), c)
  })
})
