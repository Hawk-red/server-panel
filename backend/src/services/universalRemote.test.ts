// Универсальный пульт: два столбца (Samsung и Marantz), их хранение, перенос прежнего общего списка, проверка кнопок
// и то, что исполнять нечего кроме уже разрешённых команд. Устройства не трогаются: сервис только решает,
// во что развернётся кнопка.
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
let sync: typeof import('./smarthomeSync.js')

// Выключатели «Умного дома» в реестре панели: розетка ТВ и два канала настенного выключателя
const SOCKET = 'switch.tv_marantz_sonoff_1000d31d6d'
const BALCON = 'switch.sonoff_sonoff_100094626b_1'
const LAMP = 'switch.sonoff_sonoff_100094626b_2'
const HIDDEN_SW = 'switch.hidden_device'
const haDevice = (id: string, name: string, controls: { entityId: string; name: string; state: 'on' | 'off' | 'unavailable' }[]) => ({
  id, name, manufacturer: 'Sonoff', model: 'S26R1', integration: 'sonoff', area: null, available: true,
  summary: { text: 'включено', tone: 'on' as const, extras: [] }, controls, icon: 'socket' as const,
})

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
  sync = await import('./smarthomeSync.js')
  addScene(SCENE, 'TV ON')
  addScene('scene.fire', 'FIRE', false)
  sync.applyHaSync(db.db, [
    haDevice('d-socket', 'TV  &  MARANTZ', [{ entityId: SOCKET, name: 'TV  &  MARANTZ', state: 'on' }]),
    haDevice('d-wall', 'SonOff', [
      { entityId: BALCON, name: 'Balcon', state: 'off' },
      { entityId: LAMP, name: 'Lamp', state: 'unavailable' },
    ]),
    haDevice('d-hidden', 'Скрытое', [{ entityId: HIDDEN_SW, name: 'Скрытое', state: 'on' }]),
  ])
  db.db.prepare("UPDATE smart_devices SET hidden = 1 WHERE ha_device_id = 'd-hidden'").run()
})
beforeEach(() => {
  for (const k of [uni.SETTING_KEY, uni.MIGRATED_KEY, uni.SWITCHES_KEY, uni.COLUMN_KEY.tv, uni.COLUMN_KEY.receiver]) st.setSetting(k, null)
  st.setSetting(rr.SETTING_KEY, {})
  st.setSetting(tr.SETTING_KEY, {})
  uni.setInputsSource(() => null)
})

/** К сохранённому левому столбцу разовое дополнение дописывает три плитки-выключателя */
const withSwitches = (...ids: string[]) => [...ids, 'sw-tv-socket', 'sw-balcon', 'sw-lamp']

const btn = (over: Partial<import('../services/universalRemote.js').UniButton> = {}) => ({ id: 'my-1', source: 'tv' as const, command: 'power', label: 'ТВ', icon: 'power' as const, color: 'red' as const, ...over })

describe('наборы по умолчанию', () => {
  it('левый столбец — только кнопки Samsung: питание, громкость, Mute, источник, каналы, навигация, RETURN/EXIT/MENU/INFO, play/pause', () => {
    const d = uni.getButtons('tv')
    assert.equal(uni.isDefault('tv'), true)
    assert.deepEqual(d, uni.defaults('tv'))
    assert.deepEqual([...new Set(d.map((b) => b.source))], ['tv', 'switch'])
    const cmds = d.map((b) => b.command)
    for (const c of ['power', 'vol-up', 'vol-down', 'mute', 'source', 'p-up', 'p-down', 'nav-up', 'nav-down', 'nav-left', 'nav-right', 'enter', 'return', 'exit', 'menu', 'info', 'play', 'pause']) {
      assert.ok(cmds.includes(c), `ТВ ${c}`)
    }
    assert.equal(new Set(d.map((b) => b.id)).size, d.length)
  })
  it('правый столбец — только кнопки Marantz: питание, громкость, Mute, входы, режимы звука и Smart Select 1–4', () => {
    const d = uni.getButtons('receiver')
    assert.deepEqual([...new Set(d.map((b) => b.source))], ['receiver'])
    const cmds = d.map((b) => b.command)
    for (const c of ['power', 'vol-up', 'vol-down', 'mute', 'sm-movie', 'sm-music', 'sm-game', 'sm-pure', 'ss-1', 'ss-2', 'ss-3', 'ss-4']) assert.ok(cmds.includes(c), `ресивер ${c}`)
    assert.equal(new Set(d.map((b) => b.id)).size, d.length)
  })
  it('входы правого столбца берутся из живого списка ресивера', () => {
    uni.setInputsSource(() => [
      { code: 'TV', name: 'PS4 & TV' },
      { code: 'SAT/CBL', name: 'ANDROID' },
      { code: 'CD', name: 'MacMini' },
      { code: 'НЕТ-ТАКОГО', name: 'Выдумка' },
    ])
    const d = uni.defaults('receiver')
    const inputs = d.filter((b) => b.command.startsWith('in-'))
    assert.deepEqual(inputs.map((b) => b.command), ['in-tv', 'in-cblsat', 'in-cd'])
    assert.deepEqual(inputs.map((b) => b.label), ['PS4 & TV', 'ANDROID', 'MacMini'])
    assert.equal(inputs[0].icon, 'gamepad') // «PS4 & TV» — значок как на странице ресивера
  })
  it('без живого списка входов — три обычных входа', () => {
    assert.deepEqual(uni.defaults('receiver').filter((b) => b.command.startsWith('in-')).map((b) => b.command), ['in-tv', 'in-cblsat', 'in-mplay'])
  })
  it('каждая кнопка обоих наборов есть на своём пульте', () => {
    for (const c of uni.COLUMNS) for (const b of uni.defaults(c)) assert.equal(uni.isButton(b.source, b.command), true, `${c}: ${b.source}:${b.command}`)
  })
  it('«Сбросить по умолчанию» действует на один столбец', () => {
    uni.setButtons('tv', [btn()])
    uni.setButtons('receiver', [btn({ id: 'av-1', source: 'receiver', command: 'mute' })])
    assert.equal(uni.isDefault('tv'), false)
    assert.deepEqual(uni.resetButtons('tv'), uni.defaults('tv'))
    assert.equal(uni.isDefault('tv'), true)
    assert.equal(uni.isDefault('receiver'), false) // соседний столбец не тронут
  })
})

describe('перенос прежнего общего списка', () => {
  const old = [
    btn({ id: 'tv-power' }),
    btn({ id: 'av-mute', source: 'receiver', command: 'mute', label: 'Тихо', icon: 'volume', color: 'slate' }),
    btn({ id: 'sc-1', source: 'scene', command: SCENE, label: 'Кино', icon: 'sparkles', color: 'green' }),
    btn({ id: 'av-vol', source: 'receiver', command: 'vol-up', label: 'Громче', icon: 'volume', color: 'green' }),
  ]
  it('ТВ и сцены уходят влево, ресивер — вправо, порядок и вид сохраняются', () => {
    st.setSetting(uni.SETTING_KEY, old)
    assert.deepEqual(uni.getButtons('tv').map((b) => b.id), withSwitches('tv-power', 'sc-1'))
    assert.deepEqual(uni.getButtons('receiver').map((b) => b.id), ['av-mute', 'av-vol'])
    assert.deepEqual(uni.getButtons('tv')[1], old[2])
    // ничего не потеряли: все прежние плитки на месте (плюс три дописанных выключателя)
    assert.equal(uni.getButtons('tv').filter((b) => b.source !== 'switch').length + uni.getButtons('receiver').length, old.length)
    assert.equal(uni.isDefault('tv'), false)
    assert.equal(uni.isDefault('receiver'), false)
  })
  it('переносится один раз: после сброса столбца прежний список не возвращается', () => {
    st.setSetting(uni.SETTING_KEY, old)
    uni.getButtons('tv')
    uni.resetButtons('tv')
    assert.deepEqual(uni.getButtons('tv'), uni.defaults('tv'))
    assert.deepEqual(uni.getButtons('receiver').map((b) => b.id), ['av-mute', 'av-vol']) // правый остался перенесённым
  })
  it('прежней настройки не было — оба столбца начальные', () => {
    assert.equal(uni.isDefault('tv'), true)
    assert.equal(uni.isDefault('receiver'), true)
  })
  it('в прежнем списке мусор — переносится только годное', () => {
    st.setSetting(uni.SETTING_KEY, [old[0], 'мусор', { id: 'bad' }, old[1]])
    assert.deepEqual(uni.getButtons('tv').map((b) => b.id), withSwitches('tv-power'))
    assert.deepEqual(uni.getButtons('receiver').map((b) => b.id), ['av-mute'])
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
  it('столбцы хранятся порознь, порядок сохраняется', () => {
    const list = [btn({ id: 'a' }), btn({ id: 'b', source: 'receiver', command: 'mute', label: 'Тихо', icon: 'volume', color: 'slate' }), btn({ id: 'c', source: 'scene', command: SCENE, label: 'Кино' })]
    assert.equal(uni.setButtons('tv', list).ok, true)
    assert.deepEqual(uni.getButtons('tv').map((b) => b.id), ['a', 'b', 'c'])
    assert.deepEqual(uni.getButtons('receiver'), uni.defaults('receiver')) // соседний столбец не изменился
    uni.setButtons('tv', [list[2], list[0]])
    assert.deepEqual(uni.getButtons('tv').map((b) => b.id), ['c', 'a'])
    assert.equal(uni.setButtons('receiver', [list[1]]).ok, true)
    assert.deepEqual(uni.getButtons('receiver').map((b) => b.id), ['b'])
    assert.deepEqual(uni.getButtons('tv').map((b) => b.id), ['c', 'a'])
  })
  it('в любом столбце можно держать кнопку другого устройства или сцену', () => {
    assert.equal(uni.setButtons('receiver', [btn({ id: 'x', source: 'tv', command: 'power' }), btn({ id: 'y', source: 'scene', command: SCENE, label: 'Кино' })]).ok, true)
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
      for (const c of uni.COLUMNS) assert.equal(uni.setButtons(c, [b]).ok, false, `${c}: ${JSON.stringify(b)}`)
    }
    assert.equal(uni.isDefault('tv'), true) // ничего не сохранилось
    assert.equal(uni.isDefault('receiver'), true)
  })
  it('подпись, значок, цвет и идентификатор проверяются', () => {
    for (const b of [btn({ label: '' }), btn({ label: 'x'.repeat(41) }), btn({ icon: 'нет' as never }), btn({ color: 'ЧЁРНЫЙ' as never }), btn({ id: 'Плохой ID' }), btn({ id: '' })]) {
      assert.equal(uni.setButtons('tv', [b]).ok, false, JSON.stringify(b))
    }
    assert.equal(uni.setButtons('tv', [btn({ label: '  Кино  ' })]).ok, true)
    assert.equal(uni.getButtons('tv')[0].label, 'Кино')
  })
  it('повторяющиеся идентификаторы и слишком длинный список отклоняются', () => {
    assert.equal(uni.setButtons('tv', [btn({ id: 'x' }), btn({ id: 'x' })]).ok, false)
    assert.equal(uni.setButtons('tv', Array.from({ length: uni.MAX_BUTTONS + 1 }, (_, i) => btn({ id: `k-${i}` }))).ok, false)
    assert.equal(uni.setButtons('tv', Array.from({ length: uni.MAX_BUTTONS }, (_, i) => btn({ id: `k-${i}` }))).ok, true)
  })
  it('не список и мусор внутри — отказ, пустой список допустим', () => {
    for (const v of [null, 'строка', 42, { id: 'a' }]) assert.equal(uni.setButtons('tv', v).ok, false, String(v))
    assert.equal(uni.setButtons('tv', []).ok, true)
    assert.deepEqual(uni.getButtons('tv'), [])
  })
  it('испорченная настройка не ломает страницу: негодные записи просто выпадают', () => {
    st.setSetting(uni.MIGRATED_KEY, true)
    st.setSetting(uni.COLUMN_KEY.tv, [btn({ id: 'ok-1' }), { id: 'bad' }, 'мусор', btn({ id: 'ok-2', source: 'scene', command: 'scene.нет' })])
    assert.deepEqual(uni.getButtons('tv').map((b) => b.id), withSwitches('ok-1'))
  })
})

describe('выключатели «Умного дома» на пульте', () => {
  const sw = (over: Partial<import('../services/universalRemote.js').UniButton> = {}) =>
    btn({ id: 'sw-1', source: 'switch' as const, command: SOCKET, label: 'Розетка ТВ', icon: 'socket' as const, color: 'magenta' as const, ...over })

  it('принимаются только сущности из белого списка «Умного дома»', () => {
    for (const id of [SOCKET, BALCON, LAMP]) assert.equal(uni.isButton('switch', id), true, id)
    assert.equal(uni.setButtons('tv', [sw({ command: BALCON })]).ok, true)
  })
  it('чужие домены, неизвестные и скрытые сущности отклоняются', () => {
    const bad = ['media_player.tv', 'scene.tv_on', 'sensor.kitchen_temperature', 'lock.door', 'switch.нет_такого', 'switch.unknown_entity', HIDDEN_SW, 'KEY_POWER', 'power', '__proto__', 'switch.a; rm -rf']
    for (const command of bad) {
      assert.equal(uni.isButton('switch', command), false, command)
      const r = uni.setButtons('tv', [sw({ command })])
      assert.equal(r.ok, false, command)
      if (!r.ok) assert.match(r.message, /выключател|кнопк/i)
    }
    assert.equal(uni.isDefault('tv'), true) // ничего не сохранилось
  })
  it('плитка разворачивается в entity_id, название — устройство и канал, недоступная помечается', () => {
    assert.deepEqual(uni.resolve(sw({ command: BALCON })), { resolved: BALCON, title: 'SonOff: Balcon', available: true })
    assert.deepEqual(uni.resolve(sw({ command: SOCKET })), { resolved: SOCKET, title: 'TV  &  MARANTZ: TV  &  MARANTZ', available: true })
    assert.equal(uni.resolve(sw({ command: LAMP })).available, false) // unavailable в HA
    assert.deepEqual(uni.resolve(sw({ command: 'switch.нет' })), { resolved: null, title: 'без команды', available: false })
  })
  it('справочник выключателей: имя канала и имя устройства, скрытых нет', () => {
    const list = uni.catalog().switches
    assert.deepEqual(list.map((x) => x.command), [BALCON, LAMP, SOCKET])
    assert.deepEqual(list.map((x) => x.title), ['Balcon', 'Lamp', 'TV  &  MARANTZ'])
    assert.equal(list.find((x) => x.command === BALCON)?.group, 'SonOff')
    assert.equal(list.find((x) => x.command === LAMP)?.available, false)
    assert.ok(!list.some((x) => x.command === HIDDEN_SW))
    for (const x of list) assert.equal(uni.isButton('switch', x.command), true, x.command)
  })
  it('три плитки есть в наборе по умолчанию левого столбца, в конце и с рабочими сущностями', () => {
    const d = uni.defaults('tv')
    assert.deepEqual(d.slice(-3).map((b) => b.id), ['sw-tv-socket', 'sw-balcon', 'sw-lamp'])
    assert.deepEqual(d.slice(-3).map((b) => b.command), [SOCKET, BALCON, LAMP])
    assert.deepEqual(d.slice(-3).map((b) => b.label), ['Розетка ТВ', 'Балкон', 'Лампа'])
    for (const b of d.slice(-3)) assert.equal(uni.isButton('switch', b.command), true, b.command)
    assert.equal(d.filter((b) => b.source === 'switch').length, 3)
  })
  it('разовое дополнение: три плитки дописываются в конец сохранённого набора, остальное не трогается', () => {
    const mine = [btn({ id: 'my-1' }), btn({ id: 'my-2', source: 'receiver', command: 'mute', label: 'Тихо', icon: 'volume', color: 'slate' })]
    st.setSetting(uni.MIGRATED_KEY, true)
    st.setSetting(uni.COLUMN_KEY.tv, mine)
    assert.deepEqual(uni.getButtons('tv').map((b) => b.id), ['my-1', 'my-2', 'sw-tv-socket', 'sw-balcon', 'sw-lamp'])
    assert.deepEqual(uni.getButtons('tv').slice(0, 2), mine) // прежние плитки и порядок на месте
    assert.equal(st.getSetting(uni.SWITCHES_KEY, false), true)
  })
  it('дополнение одноразовое: повтор ничего не меняет, удалённую плитку не возвращает', () => {
    st.setSetting(uni.MIGRATED_KEY, true)
    st.setSetting(uni.COLUMN_KEY.tv, [btn({ id: 'my-1' })])
    const first = uni.getButtons('tv').map((b) => b.id)
    assert.deepEqual(uni.getButtons('tv').map((b) => b.id), first) // идемпотентно
    uni.setButtons('tv', uni.getButtons('tv').filter((b) => b.id !== 'sw-lamp'))
    assert.deepEqual(uni.getButtons('tv').map((b) => b.id), ['my-1', 'sw-tv-socket', 'sw-balcon'])
  })
  it('уже стоящие плитки не дублируются', () => {
    st.setSetting(uni.MIGRATED_KEY, true)
    st.setSetting(uni.COLUMN_KEY.tv, [sw({ id: 'sw-balcon', command: BALCON, label: 'Балкон' })])
    const ids = uni.getButtons('tv').map((b) => b.id)
    assert.deepEqual(ids, ['sw-balcon', 'sw-tv-socket', 'sw-lamp'])
    assert.equal(new Set(ids).size, ids.length)
  })
  it('столбец, которого владелец не трогал, остаётся набором по умолчанию', () => {
    assert.equal(uni.isDefault('tv'), true)
    assert.deepEqual(uni.getButtons('tv'), uni.defaults('tv'))
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
