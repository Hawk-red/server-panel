import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { sidebarData } from '../components/layout/data/sidebar-data.ts'
import { applyOrder } from './layout-order.ts'
import { buildPaletteItems, filterPaletteItems } from './palette.ts'
import {
  devicesByGroup, groupBlockId, runScene, sceneRunnable, SCENE_COLORS, SCENE_ICONS, SCENES_LAYOUT_PAGE, visibleScenes, type Scene, performToggle, withControlState, ToggleGuard, controlStateOf, WAIT_MS, type SmartHomeData, groupLayoutPage, groupSummary, HA_STATUS_TEXT,
  addressFields, ALL_ROOMS, deviceBlockId, emptyForm, filterByRoom, NO_ROOM, openUrl, roomsOf, SMARTHOME_LAYOUT_PAGE, statusLabel, summaryText, toPayload, validateForm,
  type DeviceForm, type SmartDevice,
} from './smarthome.ts'

const here = (p: string) => new URL(p, import.meta.url)
const st = (state: SmartDevice['status']['state'], latencyMs: number | null = null): SmartDevice['status'] => ({ state, checkedAt: 1, latencyMs, detail: null })
const dev = (o: Partial<SmartDevice>): SmartDevice => ({ source: 'manual', haDeviceId: null, haMissing: false, ha: null, groupKey: null, groupId: 'g1', hidden: false, id: 1, name: 'Лампа', kind: 'ping', room: null, icon: 'lamp', host: '192.168.31.50', port: null, url: null, notes: null, enabled: true, status: st('online', 5), ...o })
const form = (o: Partial<DeviceForm>): DeviceForm => ({ ...emptyForm(), name: 'Лампа', kind: 'ping', host: '192.168.31.50', ...o })

describe('меню и поиск', () => {
  const items = sidebarData.navGroups.find((g) => g.title === 'Сервисы')!.items.map((i) => i.title)
  it('«Умный дом» в «Сервисах» сразу после «Ресивера», с подписью SmartHome и адресом /smarthome', () => {
    assert.equal(items[items.indexOf('Ресивер') + 1], 'Умный дом')
    const it = sidebarData.navGroups.flatMap((g) => g.items).find((i) => i.title === 'Умный дом')!
    assert.equal(it.url, '/smarthome')
    assert.equal(it.subtitle, 'SmartHome')
    assert.ok(it.icon)
  })
  const items2 = buildPaletteItems({})
  for (const q of ['умный дом', 'smarthome', 'smart home', 'гаджеты', 'устройства дома', 'умный', 'гаджет']) {
    it(`⌘K: «${q}» ведёт на /smarthome`, () => {
      const r = filterPaletteItems(items2, q)
      assert.ok(r.some((x) => x.to === '/smarthome'), r.map((x) => x.id).join(','))
    })
  }
})

describe('порядок карточек', () => {
  it('ключ страницы — smarthome, id карточек подходят серверу', () => {
    assert.equal(SMARTHOME_LAYOUT_PAGE, 'smarthome')
    assert.match(SMARTHOME_LAYOUT_PAGE, /^[a-z0-9-]{1,30}$/)
    assert.match(deviceBlockId(123456), /^[a-z0-9-]{1,40}$/)
  })
  it('сохранённый порядок применяется, удалённые устройства игнорируются, новые встают в конец', () => {
    const blocks = [1, 2, 3, 4].map((i) => ({ id: deviceBlockId(i) }))
    const r = applyOrder(blocks, ['dev-3', 'dev-99', 'dev-1']).map((b) => b.id)
    assert.deepEqual(r, ['dev-3', 'dev-1', 'dev-2', 'dev-4'])
  })
  it('страница использует тот же SortableBlocks с этим ключом', () => {
    const src = readFileSync(here('../features/smarthome/index.tsx'), 'utf8')
    assert.match(src, /SortableBlocks/)
    assert.match(src, /layoutPage=\{SMARTHOME_LAYOUT_PAGE\}/)
  })
})

describe('комнаты и сводка', () => {
  const list = [dev({ id: 1, room: 'Кухня' }), dev({ id: 2, room: 'Гостиная' }), dev({ id: 3, room: 'Кухня', status: st('offline') }), dev({ id: 4, room: null })]
  it('комнаты из введённых, по алфавиту, без дублей; «без комнаты» отдельно', () => {
    assert.deepEqual(roomsOf(list), { rooms: ['Гостиная', 'Кухня'], hasNoRoom: true })
    assert.deepEqual(roomsOf([dev({ room: 'Спальня' })]), { rooms: ['Спальня'], hasNoRoom: false })
  })
  it('фильтр по комнате', () => {
    assert.equal(filterByRoom(list, ALL_ROOMS).length, 4)
    assert.deepEqual(filterByRoom(list, 'Кухня').map((d) => d.id), [1, 3])
    assert.deepEqual(filterByRoom(list, NO_ROOM).map((d) => d.id), [4])
  })
  it('подзаголовок «N устройств · M в сети»', () => {
    assert.equal(summaryText(list), '4 устройства · 3 в сети')
    assert.equal(summaryText([dev({})]), '1 устройство · 1 в сети')
    assert.equal(summaryText([]), '0 устройств · 0 в сети')
    assert.equal(summaryText(Array.from({ length: 5 }, () => dev({}))), '5 устройств · 5 в сети')
    assert.equal(summaryText(Array.from({ length: 11 }, () => dev({}))), '11 устройств · 11 в сети')
    assert.equal(summaryText(Array.from({ length: 22 }, () => dev({}))), '22 устройства · 22 в сети')
  })
})

describe('состояние и «Открыть»', () => {
  it('подписи', () => {
    assert.equal(statusLabel(st('online', 12)), 'в сети · 12 мс')
    assert.equal(statusLabel(st('offline')), 'не в сети')
    assert.equal(statusLabel(st('checking')), 'проверяю…')
  })
  it('кнопка «Открыть»: только http/https', () => {
    assert.equal(openUrl(dev({ kind: 'link', url: 'http://192.168.31.65/' })), 'http://192.168.31.65/')
    assert.equal(openUrl(dev({ kind: 'http', url: null, host: '192.168.31.5', port: 8080 })), 'http://192.168.31.5:8080/')
    assert.equal(openUrl(dev({ kind: 'homeassistant', host: '192.168.31.112', port: null })), 'http://192.168.31.112:8123/')
    assert.equal(openUrl(dev({ kind: 'ping' })), null)
    assert.equal(openUrl(dev({ kind: 'link', url: 'javascript:alert(1)' })), null)
  })
})

describe('форма: проверка на клиенте', () => {
  it('нормальные значения проходят', () => {
    assert.deepEqual(validateForm(form({})), {})
    assert.deepEqual(validateForm(form({ kind: 'tcp', port: '22' })), {})
    assert.deepEqual(validateForm(form({ kind: 'link', host: '', url: 'https://192.168.31.1/' })), {})
  })
  it('имя 1–60', () => {
    assert.ok(validateForm(form({ name: '  ' })).name)
    assert.ok(validateForm(form({ name: 'я'.repeat(61) })).name)
  })
  it('host без пробелов и shell-символов', () => {
    for (const h of ['a b', 'x;ls', '$(id)', 'a|b', 'a/b']) assert.ok(validateForm(form({ host: h })).host, h)
  })
  it('порт 1–65535, url только http/https, обязательные поля типов', () => {
    for (const p of ['0', '65536', 'x', '1.5']) assert.ok(validateForm(form({ kind: 'tcp', port: p })).port, p)
    assert.ok(validateForm(form({ kind: 'link', url: 'ftp://192.168.1.1' })).url)
    assert.ok(validateForm(form({ kind: 'link', url: '' })).url)
    assert.ok(validateForm(form({ kind: 'tcp', port: '' })).port)
    assert.ok(validateForm(form({ kind: 'ping', host: '' })).host)
  })
  it('поля адреса зависят от типа, лишние в запрос не попадают', () => {
    assert.deepEqual(addressFields('ping'), { url: false, host: true, port: false })
    const p = toPayload(form({ kind: 'ping', port: '99', url: 'http://x/' }))
    assert.equal(p.port, null)
    assert.equal(p.url, '')
  })
})

describe('страница', () => {
  const src = readFileSync(here('../features/smarthome/index.tsx'), 'utf8')
  it('обновление статусов каждые 3 с (пока страница открыта)', () => assert.match(src, /: 3000\)/))
  it('пустое состояние с подсказкой и примерами; удаление с подтверждением', () => {
    assert.match(src, /Добавьте первое устройство/)
    assert.match(src, /ConfirmDialog/)
    assert.match(src, /Добавить устройство/)
  })
})

describe('блоки-группы и Home Assistant', () => {
  const ha = (o: Partial<SmartDevice>, tone: 'on' | 'off' | 'neutral' | 'unavailable' = 'neutral', available = true) =>
    dev({ source: 'homeassistant', kind: 'homeassistant', haDeviceId: 'abc', ha: { manufacturer: 'M', model: 'X', integration: 'tuya', area: null, available, summary: { text: 't', tone, extras: [] } }, status: st(available ? 'online' : 'offline'), ...o })

  it('ключи порядка допустимы серверу: блоки — страница smarthome, карточки группы — своя страница до 30 символов', () => {
    for (const id of ['room-a1b2c3d4', 'int-sonoff', 'int-other', 'c-abc123', 'int-' + 'x'.repeat(14)]) {
      assert.match(groupBlockId(id), /^[a-z0-9-]{1,40}$/, id)
      assert.match(groupLayoutPage(id), /^[a-z0-9-]{1,30}$/, id)
    }
    assert.notEqual(groupLayoutPage('int-sonoff'), SMARTHOME_LAYOUT_PAGE)
  })
  it('устройства раскладываются по группам; пустая группа остаётся', () => {
    const m = devicesByGroup([dev({ id: 1, groupId: 'a' }), dev({ id: 2, groupId: 'b' }), dev({ id: 3, groupId: 'a' })], [{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    assert.deepEqual([m.get('a')!.map((d) => d.id), m.get('b')!.map((d) => d.id), m.get('c')!.length], [[1, 3], [2], 0])
  })
  it('счётчик группы: «N устройств · M в сети · K включено»', () => {
    assert.equal(groupSummary([ha({ id: 1 }, 'on'), ha({ id: 2 }, 'off'), ha({ id: 3 }, 'neutral', false)]), '3 устройства · 2 в сети · 1 включено')
    assert.equal(groupSummary([ha({ id: 1 }, 'off')]), '1 устройство · 1 в сети')
    assert.equal(groupSummary([]), '0 устройств · 0 в сети')
  })
  it('подписи состояния HA и «не найдено в HA»', () => {
    assert.equal(statusLabel(st('online'), 'homeassistant'), 'доступно')
    assert.equal(statusLabel(st('offline'), 'homeassistant'), 'недоступно')
    assert.equal(statusLabel({ ...st('unknown'), detail: 'не найдено в HA' }, 'homeassistant'), 'не найдено в HA')
    assert.equal(statusLabel(st('online', 7)), 'в сети · 7 мс')
  })
  it('у устройства HA нет обычной кнопки «Открыть» (своя — «Открыть в HA»)', () => assert.equal(openUrl({ source: 'homeassistant', kind: 'homeassistant', url: null, host: null, port: null }), null))
  it('сообщения об ошибках HA', () => {
    assert.match(HA_STATUS_TEXT.unauthorized, /401/)
    assert.match(HA_STATUS_TEXT.unavailable, /недоступен/)
  })
  const idx = readFileSync(here('../features/smarthome/index.tsx'), 'utf8')
  const card = readFileSync(here('../features/smarthome/device-card.tsx'), 'utf8')
  const group = readFileSync(here('../features/smarthome/group-section.tsx'), 'utf8')
  it('плашка «Подключите Home Assistant»: путь и команда без токена', () => {
    assert.match(idx, /Подключите Home Assistant/)
    assert.match(idx, /Долгосрочные токены доступа/)
    assert.match(idx, /set-secret\.js HA_TOKEN/)
    assert.match(idx, /backend\/\.env/)
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(idx))
  })
  it('меню карточки: переименовать, переместить в группу, скрыть; «Открыть в HA»', () => {
    for (const t of ['Переименовать', 'Переместить в группу…', 'Скрыть', 'Открыть в HA']) assert.ok(card.includes(t), t)
    assert.match(idx, /config\/devices\/device\//)
  })
  it('группы: раскрывающиеся, свой ключ порядка карточек, два уровня перетаскивания', () => {
    assert.match(group, /aria-expanded/)
    assert.match(group, /pageKey=\{groupLayoutPage/)
    assert.match(idx, /Порядок групп/)
    assert.match(idx, /Порядок карточек/)
  })
  it('страница ничего не управляет: нет вызовов сервисов HA', () => {
    for (const src of [idx, card, group]) assert.ok(!/services\/(light|switch|lock|cover|climate)|turn_on|turn_off|call_service/.test(src))
  })
})

describe('переключатели switch/light', () => {
  const tx2c = dev({
    id: 7, source: 'homeassistant', haDeviceId: 'd-tx2c',
    ha: { manufacturer: null, model: null, integration: 'sonoff', area: null, available: true, summary: { text: 'включено 0 из 2', tone: 'off', extras: [] },
      controls: [{ entityId: 'switch.tx2c_balcon', name: 'Balcon', state: 'off' }, { entityId: 'switch.tx2c_lamp', name: 'Lamp', state: 'off' }] },
  })
  const mkData = (): SmartHomeData => ({ devices: [tx2c], hidden: [], groups: [], scenes: [], ha: { configured: true, status: 'ok', message: null, syncedAt: 1 }, now: 1 })
  const states = (d: SmartHomeData) => d.devices[0].ha!.controls!.map((c) => c.state)
  const holder = (post: (e: string, a: 'on' | 'off') => Promise<{ state: 'on' | 'off' | 'unavailable'; confirmed?: boolean }>) => {
    let data = mkData()
    const log: string[][] = []
    return { get: () => data, set: (d: SmartHomeData) => (log.push(states(d)), (data = d)), post: async (e: string, a: 'on' | 'off') => { const r = await post(e, a); return { confirmed: true, ...r } }, log, now: () => data }
  }

  it('withControlState: меняет одну сущность и пересчитывает итог', () => {
    const d = withControlState(mkData(), 'switch.tx2c_balcon', 'on')
    assert.deepEqual(states(d), ['on', 'off'])
    assert.equal(d.devices[0].ha!.summary.text, 'включено 1 из 2')
    assert.equal(d.devices[0].ha!.summary.tone, 'on')
    assert.equal(withControlState(mkData(), 'switch.nope', 'on').devices[0], tx2c)
  })
  it('оптимистично: состояние меняется до ответа сервера, затем подставляется реальное', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const h = holder(async () => (await gate, { state: 'on' as const }))
    const p = performToggle(h, 'switch.tx2c_balcon', true)
    assert.deepEqual(states(h.now()), ['on', 'off']) // до ответа
    release()
    assert.equal((await p).state, 'on')
    assert.deepEqual(states(h.now()), ['on', 'off'])
  })
  it('реальное состояние из ответа важнее ожидаемого', async () => {
    const h = holder(async () => ({ state: 'off' as const }))
    await performToggle(h, 'switch.tx2c_balcon', true)
    assert.deepEqual(states(h.now()), ['off', 'off'])
    assert.equal(h.now().devices[0].ha!.summary.text, 'включено 0 из 2')
  })
  it('ошибка: откат к прежнему состоянию и ошибка пробрасывается', async () => {
    const h = holder(async () => { throw new Error('Home Assistant недоступен') })
    await assert.rejects(performToggle(h, 'switch.tx2c_lamp', true), /недоступен/)
    assert.deepEqual(h.log, [['off', 'on'], ['off', 'off']]) // сначала включили, затем откатили
    assert.equal(h.now().devices[0].ha!.summary.text, 'включено 0 из 2')
  })
  it('на сервер уходит нужная команда', async () => {
    const sent: string[] = []
    const h = holder(async (e, a) => (sent.push(`${e} ${a}`), { state: a }))
    await performToggle(h, 'switch.tx2c_lamp', true)
    await performToggle(h, 'switch.tx2c_lamp', false)
    assert.deepEqual(sent, ['switch.tx2c_lamp on', 'switch.tx2c_lamp off'])
  })
})

describe('устаревший опрос и ожидание подтверждения', () => {
  const dv = dev({
    id: 7, source: 'homeassistant', haDeviceId: 'd',
    ha: { manufacturer: null, model: null, integration: 'sonoff', area: null, available: true, summary: { text: 'выключено', tone: 'off', extras: [] }, controls: [{ entityId: 'switch.a', name: 'A', state: 'off' }] },
  })
  const snapshotData = (state: 'on' | 'off'): SmartHomeData => withControlState({ devices: [dv], hidden: [], groups: [], scenes: [], ha: { configured: true, status: 'ok', message: null, syncedAt: 1 }, now: 1 }, 'switch.a', state)
  it('опрос, начатый до нажатия, не затирает оптимистичное значение', () => {
    const g = new ToggleGuard()
    const snap = g.snapshot() // опрос ушёл
    g.begin('switch.a') // нажали
    const cached = snapshotData('on')
    const r = g.applyPoll(snapshotData('off'), snap, cached) // старый ответ пришёл, пока тумблер в полёте
    assert.equal(controlStateOf(r.data, 'switch.a'), 'on')
  })
  it('опрос, начатый до нажатия, но пришедший после ответа на нажатие, тоже отбрасывается', () => {
    const g = new ToggleGuard()
    const snap = g.snapshot()
    g.begin('switch.a')
    g.end('switch.a')
    assert.equal(controlStateOf(g.applyPoll(snapshotData('off'), snap, snapshotData('on')).data, 'switch.a'), 'on')
  })
  it('опрос, начатый после нажатия, принимается', () => {
    const g = new ToggleGuard()
    g.begin('switch.a')
    g.end('switch.a')
    const r = g.applyPoll(snapshotData('off'), g.snapshot(), snapshotData('on'))
    assert.equal(controlStateOf(r.data, 'switch.a'), 'off')
  })
  it('без кэша ответ опроса принимается как есть', () => {
    const g = new ToggleGuard()
    g.begin('switch.a')
    assert.equal(controlStateOf(g.applyPoll(snapshotData('off'), g.snapshot(), undefined).data, 'switch.a'), 'off')
  })
  it('confirmed=false: ожидаемое состояние держится поверх опроса, пока опрос не совпадёт', () => {
    const g = new ToggleGuard()
    g.hold('switch.a', 'on')
    const a = g.applyPoll(snapshotData('off'), g.snapshot(), snapshotData('on'))
    assert.equal(controlStateOf(a.data, 'switch.a'), 'on')
    assert.deepEqual(a.released, [])
    const b = g.applyPoll(snapshotData('on'), g.snapshot(), a.data) // устройство наконец сработало
    assert.deepEqual(b.released, ['switch.a'])
    const c = g.applyPoll(snapshotData('off'), g.snapshot(), b.data) // удержания больше нет: правда за опросом
    assert.equal(controlStateOf(c.data, 'switch.a'), 'off')
  })
  it('после release() опрос показывает реальное состояние', () => {
    const g = new ToggleGuard()
    g.hold('switch.a', 'on')
    g.release('switch.a')
    assert.equal(controlStateOf(g.applyPoll(snapshotData('off'), g.snapshot(), snapshotData('on')).data, 'switch.a'), 'off')
  })
  it('ответ сервера (confirmed=false) приходит в performToggle как есть, индикатор не дольше 3 с', async () => {
    let data = snapshotData('off')
    const r = await performToggle({ get: () => data, set: (d) => (data = d), post: async () => ({ state: 'off' as const, confirmed: false }) }, 'switch.a', true)
    assert.deepEqual(r, { state: 'off', confirmed: false })
    assert.equal(WAIT_MS, 3000)
  })
  it('страница: опрос раз в 3 с, индикатор ожидания, toast «Устройство не подтвердило»', () => {
    const idx = readFileSync(here('../features/smarthome/index.tsx'), 'utf8')
    const card = readFileSync(here('../features/smarthome/device-card.tsx'), 'utf8')
    assert.match(idx, /: 3000\)/)
    assert.ok(!/refetchIntervalInBackground/.test(idx.replace(/\/\/.*$/gm, '')))
    assert.match(idx, /Устройство не подтвердило/)
    assert.match(card, /Ожидание подтверждения/)
  })
})

describe('быстрые сцены', () => {
  const scene = (o: Partial<Scene>): Scene => ({ id: 'sc-tv-on', entityId: 'scene.tv_on', name: 'TV ON', haName: 'TV ON', nameCustom: false, color: 'green', icon: 'tv', hidden: false, missing: false, available: true, ...o })
  it('запуск: на сервер уходит entity_id, успех — ok', async () => {
    const sent: string[] = []
    const r = await runScene(async (id) => void sent.push(id), 'scene.tv_on', String)
    assert.deepEqual([r, sent], [{ ok: true }, ['scene.tv_on']])
  })
  it('ошибка запуска возвращается текстом, а не исключением', async () => {
    const r = await runScene(async () => { throw new Error('Home Assistant недоступен') }, 'scene.tv_on', (e) => (e as Error).message)
    assert.deepEqual(r, { ok: false, message: 'Home Assistant недоступен' })
  })
  it('скрытые и пропавшие видны только в режиме изменения; недоступные не запускаются', () => {
    const list = [scene({}), scene({ entityId: 'scene.a', hidden: true }), scene({ entityId: 'scene.b', missing: true }), scene({ entityId: 'scene.c', available: false })]
    assert.deepEqual(visibleScenes(list, false).map((s) => s.entityId), ['scene.tv_on', 'scene.c'])
    assert.equal(visibleScenes(list, true).length, 4)
    assert.deepEqual(list.map(sceneRunnable), [true, false, false, false])
  })
  it('палитра: 10 цветов, не меньше 12 значков, ключ порядка подходит серверу', () => {
    assert.equal(SCENE_COLORS.length, 10)
    assert.ok(SCENE_ICONS.length >= 12)
    assert.match(SCENES_LAYOUT_PAGE, /^[a-z0-9-]{1,30}$/)
    assert.deepEqual(SCENE_COLORS.slice(0, 8), ['green', 'red', 'magenta', 'blue', 'brown', 'emerald', 'violet', 'orange'])
  })
  it('⌘K: «Сцена: <имя>» для запускаемых сцен, выбор запускает сцену', () => {
    const items = buildPaletteItems({ scenes: [scene({}), scene({ entityId: 'scene.a', name: 'OFF', hidden: true }), scene({ entityId: 'scene.c', name: 'Dead', available: false })] })
    const sc = items.filter((i) => i.id.startsWith('scene:'))
    assert.deepEqual(sc.map((i) => [i.title, i.scene]), [['Сцена: TV ON', 'scene.tv_on']])
    assert.ok(filterPaletteItems(items, 'сцена tv').some((i) => i.scene === 'scene.tv_on'))
  })
  it('все цвета и значки имеют оформление (серверные списки совпадают с интерфейсом)', async () => {
    const { SCENE_BG } = await import('../features/smarthome/scene-style.ts')
    for (const c of SCENE_COLORS) assert.ok(SCENE_BG[c], c)
  })
})
