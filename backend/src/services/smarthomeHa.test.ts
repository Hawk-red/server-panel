// Тесты Home Assistant (только чтение) на подставных ответах: разбор устройств, фильтрация служебных интеграций, блоки по комнате/интеграции,
// ошибки (нет токена, 401, HA недоступен), синхронизация без потери раскладки владельца, маскирование токена. Реальный HA не вызывается.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import Database from 'better-sqlite3'
import { maskSecrets, errText } from '../mask.js'
import { buildDevices, HaError, readDevices, type HaDevice, type HaRaw } from './haClient.js'
import { defaultGroup, resolveGroups, roomGroupId, validateGroupName } from './smarthomeGroups.js'
import { SMART_DEVICES_DDL, SMART_DEVICES_HA_DDL } from './smarthomeSchema.js'
import { applyHaSync } from './smarthomeSync.js'

const dev = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, name_by_user: null, manufacturer: 'M', model: 'X', area_id: null, disabled_by: null, entry_type: null, identifiers: [['tuya', 'SECRET-ID']], connections: [['mac', 'aa:bb']], config_entries: ['entry-with-account'], ...extra })
const ent = (entity_id: string, device_id: string, platform: string, extra: Record<string, unknown> = {}) => ({ entity_id, device_id, platform, disabled_by: null, hidden_by: null, entity_category: null, area_id: null, ...extra })
const st = (entity_id: string, state: string, attributes: Record<string, unknown> = {}) => ({ entity_id, state, attributes })

const RAW: HaRaw = {
  areas: [{ area_id: 'living', name: 'Гостиная' }, { area_id: 'kitchen', name: 'Кухня' }],
  devices: [
    dev('d-lamp', 'Лампа', { area_id: 'living' }),
    dev('d-sonoff', 'Розетка Sonoff'),
    dev('d-multi', 'Двойной выключатель'),
    dev('d-sensor', 'Датчик кухни', { area_id: 'kitchen' }),
    dev('d-ac', 'Кондиционер', { name_by_user: 'Кондей' }),
    dev('d-dead', 'Выключенная камера'),
    dev('d-sun', 'Sun', { entry_type: 'service' }),
    dev('d-bt', 'Apple, Inc.'),
    dev('d-backup', 'Backup'),
    dev('d-off', 'Отключённое', { disabled_by: 'user' }),
    dev('d-noent', 'Без сущностей'),
    dev('d-hid', 'Только скрытая сущность'),
    dev('d-tuya-other', 'Пульт Tuya'),
  ],
  entities: [
    ent('light.lamp', 'd-lamp', 'tuya'),
    ent('switch.sonoff', 'd-sonoff', 'sonoff'),
    ent('switch.multi_1', 'd-multi', 'sonoff'),
    ent('switch.multi_2', 'd-multi', 'sonoff'),
    ent('sensor.kitchen_temperature', 'd-sensor', 'tuya', { area_id: 'kitchen' }),
    ent('sensor.kitchen_humidity', 'd-sensor', 'tuya'),
    ent('sensor.kitchen_battery', 'd-sensor', 'tuya', { entity_category: 'diagnostic' }),
    ent('climate.ac', 'd-ac', 'tuya'),
    ent('camera.dead', 'd-dead', 'tuya'),
    ent('sensor.sun_next_dawn', 'd-sun', 'sun'),
    ent('sensor.bt', 'd-bt', 'bluetooth'),
    ent('sensor.backup_state', 'd-backup', 'backup'),
    ent('switch.off', 'd-off', 'tuya'),
    ent('switch.hidden', 'd-hid', 'tuya', { hidden_by: 'user' }),
    ent('sensor.cfg', 'd-hid', 'tuya', { entity_category: 'config' }),
    ent('remote.ir', 'd-tuya-other', 'tuya'),
    ent('sensor.helper', null as unknown as string, 'template'), // без устройства — не показывается
  ],
  states: [
    st('light.lamp', 'off', { friendly_name: 'Лампа' }),
    st('switch.sonoff', 'on', { friendly_name: 'Розетка Sonoff' }),
    st('switch.multi_1', 'on'), st('switch.multi_2', 'off'),
    st('sensor.kitchen_temperature', '23.4', { friendly_name: 'Датчик кухни Temperature', device_class: 'temperature', unit_of_measurement: '°C' }),
    st('sensor.kitchen_humidity', '41', { friendly_name: 'Датчик кухни Humidity', device_class: 'humidity', unit_of_measurement: '%' }),
    st('sensor.kitchen_battery', '88', { device_class: 'battery', unit_of_measurement: '%' }),
    st('climate.ac', 'cool', { current_temperature: 24, friendly_name: 'Кондей' }),
    st('camera.dead', 'unavailable'),
    st('sensor.sun_next_dawn', '2026-10-20T04:00:00+00:00'),
    st('sensor.bt', 'on'), st('sensor.backup_state', 'idle'), st('switch.off', 'on'), st('switch.hidden', 'on'), st('sensor.cfg', '1'),
    st('remote.ir', 'on'),
  ],
}
const byId = (list: HaDevice[], id: string) => list.find((d) => d.id === id)!

describe('разбор устройств HA', () => {
  const list = buildDevices(RAW)
  it('служебные, отключённые, скрытые и без сущностей не попадают', () => {
    const ids = list.map((d) => d.id).sort()
    assert.deepEqual(ids, ['d-ac', 'd-dead', 'd-lamp', 'd-multi', 'd-sensor', 'd-sonoff', 'd-tuya-other'])
    for (const bad of ['d-sun', 'd-bt', 'd-backup', 'd-off', 'd-noent', 'd-hid']) assert.ok(!ids.includes(bad), bad)
  })
  it('имя, производитель/модель, интеграция, область', () => {
    const l = byId(list, 'd-lamp')
    assert.deepEqual([l.name, l.manufacturer, l.model, l.integration, l.area], ['Лампа', 'M', 'X', 'tuya', 'Гостиная'])
    assert.equal(byId(list, 'd-sonoff').integration, 'sonoff')
    assert.equal(byId(list, 'd-sonoff').area, null)
    assert.equal(byId(list, 'd-ac').name, 'Кондей') // имя, заданное пользователем в HA
  })
  it('область берётся и из сущности, если у устройства её нет', () => assert.equal(byId(list, 'd-sensor').area, 'Кухня'))
  it('switch/light: включено/выключено', () => {
    assert.deepEqual([byId(list, 'd-sonoff').summary.text, byId(list, 'd-sonoff').summary.tone], ['включено', 'on'])
    assert.deepEqual([byId(list, 'd-lamp').summary.text, byId(list, 'd-lamp').summary.tone], ['выключено', 'off'])
    assert.equal(byId(list, 'd-multi').summary.text, 'включено 1 из 2')
  })
  it('sensor: значение с единицей, диагностические не показываются', () => {
    const s = byId(list, 'd-sensor').summary
    assert.equal(s.text, '23,4 °C')
    assert.deepEqual(s.extras, [{ label: 'Влажность', value: '41', unit: '%' }])
  })
  it('climate: температура', () => assert.equal(byId(list, 'd-ac').summary.text, '24 °C'))
  it('прочее — «доступно», недоступное — «недоступно»', () => {
    assert.equal(byId(list, 'd-tuya-other').summary.text, 'доступно')
    const dead = byId(list, 'd-dead')
    assert.deepEqual([dead.available, dead.summary.text, dead.summary.tone], [false, 'недоступно', 'unavailable'])
    assert.equal(byId(list, 'd-lamp').available, true)
  })
  it('значок по типу сущности', () => {
    assert.deepEqual([byId(list, 'd-lamp').icon, byId(list, 'd-sonoff').icon, byId(list, 'd-sensor').icon, byId(list, 'd-ac').icon, byId(list, 'd-dead').icon], ['lamp', 'socket', 'sensor', 'ac', 'camera'])
  })
  it('идентификаторы, адреса и аккаунты из реестра не попадают в результат', () => {
    const json = JSON.stringify(list)
    for (const secret of ['SECRET-ID', 'aa:bb', 'entry-with-account', 'identifiers', 'connections', 'config_entries']) assert.ok(!json.includes(secret), secret)
  })
})

describe('ошибки HA', () => {
  it('токен не задан', async () => {
    await assert.rejects(readDevices({ url: 'http://127.0.0.1:8123', token: '' }), (e: HaError) => e.status === 'no-token')
  })
  it('401 и недоступность передаются статусом, без 500', async () => {
    await assert.rejects(readDevices({ url: 'x', token: 't', transport: async () => { throw new HaError('unauthorized', '401') } }), (e: HaError) => e.status === 'unauthorized')
    await assert.rejects(readDevices({ url: 'x', token: 't', transport: async () => { throw new HaError('unavailable', 'Home Assistant недоступен') } }), (e: HaError) => e.status === 'unavailable')
  })
  it('успешный ответ разбирается через подставной транспорт', async () => {
    const list = await readDevices({ url: 'x', token: 't', transport: async () => RAW })
    assert.equal(list.length, 7)
  })
})

describe('блоки по умолчанию', () => {
  const ha = (integration: string) => ({ integration })
  it('комната — по ней; иначе интеграция; иначе «Прочее»', () => {
    assert.equal(defaultGroup({ room: 'Гостиная', ha: ha('tuya') }).name, 'Гостиная')
    assert.deepEqual([defaultGroup({ room: null, ha: ha('sonoff') }).name, defaultGroup({ room: null, ha: ha('tuya') }).name, defaultGroup({ room: null, ha: ha('zha') }).name], ['Sonoff', 'Tuya', 'Прочее'])
    assert.equal(defaultGroup({ room: null, ha: null }).name, 'Прочее')
  })
  it('комната одинакова для области HA и ручного устройства (без учёта регистра); у блока есть цвет и значок', () => {
    assert.equal(defaultGroup({ room: 'Кухня', ha: null }).id, defaultGroup({ room: ' кухня ', ha: ha('tuya') }).id)
    const g = defaultGroup({ room: 'Кухня', ha: null })
    assert.ok(g.accent && g.icon)
    assert.match(g.id, /^[a-z0-9-]{1,40}$/)
  })
  it('выбор владельца действует; удалённый или несуществующий блок — возврат к умолчанию', () => {
    const devs = [
      { id: 1, room: 'Кухня', groupKey: null, ha: null },
      { id: 2, room: null, groupKey: 'c-aaaaaa', ha: { integration: 'tuya' } },
      { id: 3, room: null, groupKey: 'c-gone', ha: { integration: 'sonoff' } },
      { id: 4, room: null, groupKey: roomGroupId('Кухня'), ha: { integration: 'tuya' } },
    ]
    const r = resolveGroups(devs, [{ id: 'c-aaaaaa', name: 'Мой', accent: 'ok', icon: 'folder' }])
    assert.deepEqual([...r.groupOf.entries()], [[1, roomGroupId('Кухня')], [2, 'c-aaaaaa'], [3, 'int-sonoff'], [4, roomGroupId('Кухня')]])
    assert.deepEqual(r.groups.map((g) => g.name), ['Кухня', 'Sonoff', 'Мой'])
  })
  it('пустой собственный блок остаётся; название блока 1–40', () => {
    assert.equal(resolveGroups([], [{ id: 'c-bbbbbb', name: 'Пустой', accent: 'ok', icon: 'folder' }]).groups.length, 1)
    assert.equal(validateGroupName('').ok, false)
    assert.equal(validateGroupName('я'.repeat(41)).ok, false)
    assert.deepEqual(validateGroupName(' Спальня '), { ok: true, name: 'Спальня' })
  })
})

describe('синхронизация в реестр', () => {
  const mk = () => {
    const db = new Database(':memory:')
    db.exec(SMART_DEVICES_DDL)
    db.exec(SMART_DEVICES_HA_DDL)
    db.prepare("INSERT INTO smart_devices (name, kind, host, created_at, updated_at) VALUES ('Ручная лампа','ping','192.168.31.50',1,1)").run()
    return db
  }
  const rows = (db: Database.Database) => db.prepare('SELECT * FROM smart_devices ORDER BY id').all() as Record<string, unknown>[]
  const list = buildDevices(RAW)

  it('миграция: колонки и значения по умолчанию, ручные остаются manual', () => {
    const db = mk()
    const r = rows(db)[0]
    assert.deepEqual([r.source, r.ha_missing, r.name_custom, r.hidden, r.group_key], ['manual', 0, 0, 0, null])
  })
  it('первая синхронизация добавляет; ручные не трогаются', () => {
    const db = mk()
    assert.deepEqual(applyHaSync(db, list, 100), { added: 7, updated: 0, missing: 0 })
    const all = rows(db)
    assert.equal(all.length, 8)
    assert.deepEqual([all[0].name, all[0].source, all[0].host], ['Ручная лампа', 'manual', '192.168.31.50'])
    const lamp = all.find((r) => r.ha_device_id === 'd-lamp')!
    assert.deepEqual([lamp.source, lamp.kind, lamp.room, lamp.icon], ['homeassistant', 'homeassistant', 'Гостиная', 'lamp'])
    assert.ok(!JSON.stringify(lamp).includes('SECRET'))
  })
  it('повторная: обновляет имя/комнату/состояние, но не сбрасывает выбор владельца', () => {
    const db = mk()
    applyHaSync(db, list, 100)
    const id = (rows(db).find((r) => r.ha_device_id === 'd-lamp')!).id
    const sonoff = (rows(db).find((r) => r.ha_device_id === 'd-sonoff')!).id
    // владелец: переименовал лампу, переложил в свой блок, скрыл розетку
    db.prepare("UPDATE smart_devices SET name = 'Торшер', name_custom = 1, group_key = 'c-aaaaaa' WHERE id = ?").run(id)
    db.prepare('UPDATE smart_devices SET hidden = 1 WHERE id = ?').run(sonoff)
    // в HA лампа переименована, переехала в кухню и включилась
    const changed = list.map((d) => (d.id === 'd-lamp' ? { ...d, name: 'Лампа (HA)', area: 'Кухня', summary: { ...d.summary, text: 'включено', tone: 'on' as const } } : d.id === 'd-sensor' ? { ...d, name: 'Датчик 2' } : d))
    assert.deepEqual(applyHaSync(db, changed, 200), { added: 0, updated: 7, missing: 0 })
    const lamp = rows(db).find((r) => r.id === id)!
    assert.deepEqual([lamp.name, lamp.group_key, lamp.room], ['Торшер', 'c-aaaaaa', 'Кухня']) // имя и блок владельца целы, комната из HA обновлена
    assert.ok(String(lamp.ha_info).includes('включено'))
    assert.equal((rows(db).find((r) => r.id === sonoff)!).hidden, 1)
    assert.equal((rows(db).find((r) => r.ha_device_id === 'd-sensor')!).name, 'Датчик 2') // не переименованное владельцем обновляется
  })
  it('пропавшие помечаются, не удаляются; вернувшиеся снова обычные', () => {
    const db = mk()
    applyHaSync(db, list, 100)
    const fewer = list.filter((d) => d.id !== 'd-ac')
    assert.deepEqual(applyHaSync(db, fewer, 200), { added: 0, updated: 6, missing: 1 })
    assert.equal(rows(db).length, 8)
    assert.equal((rows(db).find((r) => r.ha_device_id === 'd-ac')!).ha_missing, 1)
    assert.equal((rows(db)[0]).ha_missing, 0) // ручное не помечено
    applyHaSync(db, list, 300)
    assert.equal((rows(db).find((r) => r.ha_device_id === 'd-ac')!).ha_missing, 0)
  })
  it('сбой HA (пустая выдача не вызывается): без вызова sync данные остаются', () => {
    const db = mk()
    applyHaSync(db, list, 100)
    assert.equal(rows(db).filter((r) => r.ha_missing === 1).length, 0)
  })
})

describe('маскирование токена', () => {
  const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJhYmNkZWYxMjM0NTY3ODkwIiwiaWF0IjoxNzAwMDAwMDAwfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
  it('JWT и Bearer скрываются в тексте, ошибке и JSON', () => {
    assert.ok(!maskSecrets(`GET /api/states Authorization: Bearer ${TOKEN}`).includes(TOKEN.slice(10, 40)))
    assert.ok(!maskSecrets(`token=${TOKEN}`).includes('eyJhbGci'))
    assert.ok(!errText(new Error(`auth failed ${TOKEN}`)).includes(TOKEN.slice(20, 50)))
    assert.ok(!maskSecrets(JSON.stringify({ details: { token: TOKEN } })).includes('SflKx'))
  })
  it('обычный текст не меняется', () => assert.equal(maskSecrets('Home Assistant недоступен'), 'Home Assistant недоступен'))
})

describe('транспорт на локальном подставном HA (WebSocket + REST)', async () => {
  const { createServer } = await import('node:http')
  const { WebSocketServer } = await import('ws')
  const { liveTransport } = await import('./haClient.js')
  const GOOD = 'good-token-0123456789-0123456789-0123456789'
  const seen: { rest: string[]; ws: string[] } = { rest: [], ws: [] }
  const srv = createServer((req, res) => {
    seen.rest.push(`${req.method} ${req.url}`)
    if (req.headers.authorization !== `Bearer ${GOOD}`) { res.statusCode = 401; return res.end('{}') }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(RAW.states))
  })
  const wss = new WebSocketServer({ server: srv, path: '/api/websocket' })
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'auth_required' }))
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString())
      seen.ws.push(m.type)
      if (m.type === 'auth') return ws.send(JSON.stringify({ type: m.access_token === GOOD ? 'auth_ok' : 'auth_invalid' }))
      const result = m.type === 'config/device_registry/list' ? RAW.devices : m.type === 'config/area_registry/list' ? RAW.areas : RAW.entities
      ws.send(JSON.stringify({ id: m.id, type: 'result', success: true, result }))
    })
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}`
  const { after } = await import('node:test')
  after(() => { wss.close(); srv.close() })

  it('читает реестры и состояния; только команды чтения', async () => {
    const list = await readDevices({ url, token: GOOD })
    assert.equal(list.length, 7)
    assert.deepEqual(seen.ws.filter((t) => t !== 'auth').sort(), ['config/area_registry/list', 'config/device_registry/list', 'config/entity_registry/list'])
    assert.ok(seen.rest.every((r) => r === 'GET /api/states'))
  })
  it('неверный токен → unauthorized', async () => {
    await assert.rejects(readDevices({ url, token: 'bad-token-0123456789-0123456789-0123456789' }), (e: HaError) => e.status === 'unauthorized')
  })
  it('HA не запущен → unavailable', async () => {
    await assert.rejects(readDevices({ url: 'http://127.0.0.1:1', token: GOOD }), (e: HaError) => e.status === 'unavailable')
  })
  it('публичный адрес HA_URL отклоняется до соединения', async () => {
    await assert.rejects(liveTransport('http://8.8.8.8:8123', GOOD), (e: HaError) => e.status === 'error' && /локальной сети/.test(e.message))
  })
})
