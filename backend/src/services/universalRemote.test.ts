// Универсальный пульт: хранение списка, проверка кнопок и то, что исполнять нечего кроме уже разрешённых команд.
// Устройства не трогаются: сервис только решает, во что развернётся кнопка.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, beforeEach, describe, it } from 'node:test'

let uni: typeof import('../services/universalRemote.js')
let st: typeof import('../settings.js')
let rr: typeof import('../services/receiverRemote.js')
let tr: typeof import('../services/tvRemote.js')
let db: typeof import('../db.js')

const SCENE = 'scene.tv_on'
const addScene = (entityId: string, name: string, available = true) =>
  db.db.prepare('INSERT OR REPLACE INTO smart_scenes (entity_id, ha_name, name, color, icon, hidden, missing, available, first_seen, updated_at) VALUES (?, ?, NULL, NULL, NULL, 0, 0, ?, ?, ?)')
    .run(entityId, name, available ? 1 : 0, Date.now(), Date.now())

before(async () => {
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'uni-test-'))
  db = await import('../db.js')
  uni = await import('./universalRemote.js')
  st = await import('../settings.js')
  rr = await import('./receiverRemote.js')
  tr = await import('./tvRemote.js')
  addScene(SCENE, 'TV ON')
  addScene('scene.fire', 'FIRE', false)
})
beforeEach(() => {
  st.setSetting(uni.SETTING_KEY, null)
  st.setSetting(rr.SETTING_KEY, {})
  st.setSetting(tr.SETTING_KEY, {})
})

const btn = (over: Partial<import('../services/universalRemote.js').UniButton> = {}) => ({ id: 'my-1', source: 'tv' as const, command: 'power', label: 'ТВ', icon: 'power' as const, color: 'red' as const, ...over })

describe('набор по умолчанию', () => {
  it('пустые настройки — начальный набор: питание обоих, громкость ресивера, навигация ТВ, входы и режимы', () => {
    const d = uni.getButtons()
    assert.equal(uni.isDefault(), true)
    assert.deepEqual(d, uni.DEFAULTS)
    const by = (source: string, command: string) => d.find((b) => b.source === source && b.command === command)
    for (const c of ['power', 'vol-up', 'vol-down', 'mute', 'in-tv', 'in-cblsat', 'in-mplay', 'sm-movie', 'sm-music', 'sm-game', 'sm-pure']) assert.ok(by('receiver', c), `ресивер ${c}`)
    for (const c of ['power', 'nav-up', 'nav-down', 'nav-left', 'nav-right', 'enter', 'return', 'exit', 'menu']) assert.ok(by('tv', c), `ТВ ${c}`)
    assert.equal(new Set(d.map((b) => b.id)).size, d.length) // идентификаторы не повторяются
  })
  it('каждая кнопка набора есть на своём пульте', () => {
    for (const b of uni.DEFAULTS) assert.equal(uni.isButton(b.source, b.command), true, `${b.source}:${b.command}`)
  })
  it('«Сбросить по умолчанию» убирает настройку', () => {
    uni.setButtons([btn()])
    assert.equal(uni.isDefault(), false)
    assert.deepEqual(uni.resetButtons(), uni.DEFAULTS)
    assert.equal(uni.isDefault(), true)
  })
})

describe('во что разворачивается кнопка', () => {
  it('ресивер и ТВ — через привязки своих пультов', () => {
    assert.deepEqual(uni.resolve(btn({ source: 'receiver', command: 'vol-up' })), { resolved: 'MVUP', title: 'Громче', available: true })
    assert.equal(uni.resolve(btn({ source: 'tv', command: 'nav-up' })).resolved, 'KEY_UP')
  })
  it('изменил привязку на пульте — поменялась и плитка', () => {
    rr.setBinding('vol-up', 'MVDOWN')
    assert.equal(uni.resolve(btn({ source: 'receiver', command: 'vol-up' })).resolved, 'MVDOWN')
    tr.setBinding('enter', 'KEY_MENU')
    assert.equal(uni.resolve(btn({ source: 'tv', command: 'enter' })).resolved, 'KEY_MENU')
  })
  it('кнопка без команды — серая', () => {
    rr.setBinding('vol-up', null)
    assert.deepEqual(uni.resolve(btn({ source: 'receiver', command: 'vol-up' })), { resolved: null, title: 'без команды', available: false })
    assert.equal(uni.resolve(btn({ source: 'receiver', command: 'in-8k' })).resolved, null) // у NR1604 такого входа нет
  })
  it('сцена: имя из панели, недоступная помечается', () => {
    assert.deepEqual(uni.resolve(btn({ source: 'scene', command: SCENE })), { resolved: SCENE, title: 'TV ON', available: true })
    assert.equal(uni.resolve(btn({ source: 'scene', command: 'scene.fire' })).available, false)
  })
})

describe('проверка списка при сохранении', () => {
  it('сохраняется и читается обратно, порядок сохраняется', () => {
    const list = [btn({ id: 'a' }), btn({ id: 'b', source: 'receiver', command: 'mute', label: 'Тихо', icon: 'volume', color: 'slate' }), btn({ id: 'c', source: 'scene', command: SCENE, label: 'Кино' })]
    const r = uni.setButtons(list)
    assert.equal(r.ok, true)
    assert.deepEqual(uni.getButtons().map((b) => b.id), ['a', 'b', 'c'])
    uni.setButtons([list[2], list[0]])
    assert.deepEqual(uni.getButtons().map((b) => b.id), ['c', 'a'])
  })
  it('неизвестная команда, чужой пульт и несуществующая сцена отклоняются', () => {
    const bad = [
      { ...btn({ command: 'KEY_POWER' }) }, // ключ вместо кнопки пульта
      { ...btn({ command: 'нет-такой' }) },
      { ...btn({ source: 'receiver', command: 'nav-up2' }) },
      { ...btn({ source: 'receiver', command: 'power2' }) },
      { ...btn({ source: 'scene', command: 'scene.нет' }) },
      { ...btn({ source: 'scene', command: 'switch.kettle' }) },
      { ...btn({ source: 'scene', command: 'scene.fire; rm -rf' }) },
      { ...btn({ source: 'light' as never }) },
      { ...btn({ command: '__proto__' }) },
    ]
    for (const b of bad) {
      const r = uni.setButtons([b])
      assert.equal(r.ok, false, JSON.stringify(b))
    }
    assert.equal(uni.isDefault(), true) // ничего не сохранилось
  })
  it('подпись, значок, цвет и идентификатор проверяются', () => {
    for (const b of [btn({ label: '' }), btn({ label: 'x'.repeat(41) }), btn({ icon: 'нет' as never }), btn({ color: 'ЧЁРНЫЙ' as never }), btn({ id: 'Плохой ID' }), btn({ id: '' })]) {
      assert.equal(uni.setButtons([b]).ok, false, JSON.stringify(b))
    }
    assert.equal(uni.setButtons([btn({ label: '  Кино  ' })]).ok, true)
    assert.equal(uni.getButtons()[0].label, 'Кино')
  })
  it('повторяющиеся идентификаторы и слишком длинный список отклоняются', () => {
    assert.equal(uni.setButtons([btn({ id: 'x' }), btn({ id: 'x' })]).ok, false)
    assert.equal(uni.setButtons(Array.from({ length: uni.MAX_BUTTONS + 1 }, (_, i) => btn({ id: `k-${i}` }))).ok, false)
    assert.equal(uni.setButtons(Array.from({ length: uni.MAX_BUTTONS }, (_, i) => btn({ id: `k-${i}` }))).ok, true)
  })
  it('не список и мусор внутри — отказ, пустой список допустим', () => {
    for (const v of [null, 'строка', 42, { id: 'a' }]) assert.equal(uni.setButtons(v).ok, false, String(v))
    assert.equal(uni.setButtons([]).ok, true)
    assert.deepEqual(uni.getButtons(), [])
  })
  it('испорченная настройка не ломает страницу: негодные записи просто выпадают', () => {
    st.setSetting(uni.SETTING_KEY, [btn({ id: 'ok-1' }), { id: 'bad' }, 'мусор', btn({ id: 'ok-2', source: 'scene', command: 'scene.нет' })])
    assert.deepEqual(uni.getButtons().map((b) => b.id), ['ok-1'])
  })
})

describe('справочник для диалога «Добавить кнопку»', () => {
  it('кнопки обоих пультов и видимые сцены, названия берутся из привязок', () => {
    const c = uni.catalog()
    assert.deepEqual(c.receiver.map((x) => x.command), rr.REMOTE_BUTTONS)
    assert.deepEqual(c.tv.map((x) => x.command), tr.REMOTE_BUTTONS)
    assert.equal(c.receiver.find((x) => x.command === 'vol-up')?.title, 'Громче')
    assert.equal(c.tv.find((x) => x.command === 'num-1')?.title, 'Цифра 1')
    const scene = c.scenes.find((x) => x.command === SCENE)
    assert.equal(scene?.title, 'TV ON')
    assert.equal(c.scenes.find((x) => x.command === 'scene.fire')?.available, false)
  })
  it('в справочнике только то, что сервер потом примет', () => {
    const c = uni.catalog()
    for (const x of c.receiver) assert.equal(uni.isButton('receiver', x.command), true, x.command)
    for (const x of c.tv) assert.equal(uni.isButton('tv', x.command), true, x.command)
    for (const x of c.scenes) assert.equal(uni.isButton('scene', x.command), true, x.command)
  })
})
