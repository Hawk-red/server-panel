/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Универсальный пульт на мок-данных: два столбца, их начальные наборы, серые плитки, режим «Изменить», добавление и удаление.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { performToggle, withControlState, type SmartHomeData } from '@/lib/smarthome'
import { filterItems, SOURCE_LABEL, removeButton, stripView, upsertButton, draftButton, uniStatus, uniSwitchState, UNI_COLUMNS, UNI_COLUMN_TITLE, type UniButtonView } from '@/lib/universal-pad'
import { UniversalPad } from './universal-pad'
import { RECEIVER_ON, SWITCH_STATES, TV_ON, UNI_DATA, UNI_RECEIVER, UNI_TV } from './universal-mock'

const noop = () => {}
const st = { receiver: RECEIVER_ON, tv: TV_ON, switches: SWITCH_STATES }
const html = (over: { buttons?: UniButtonView[]; editing?: boolean; st?: typeof st; busy?: Set<string> } = {}) =>
  renderToStaticMarkup(<UniversalPad buttons={over.buttons ?? UNI_TV} st={over.st ?? st} editing={over.editing ?? false} busy={over.busy} onPress={noop} onEdit={noop} onRemove={noop} />)
const state = (h: string, id: string) => new RegExp(`data-tile="${id}"[^>]*data-state="(\\w+)"`).exec(h)?.[1]
const tile = (h: string, id: string) => new RegExp(`<button[^>]*data-tile="${id}"[^>]*>`).exec(h)?.[0] ?? ''
const sw = (id: string): UniButtonView => UNI_TV.find((b) => b.id === id)!

describe('универсальный пульт: два столбца', () => {
  it('столбцы называются Samsung и Marantz, слева ТВ, справа ресивер', () => {
    assert.deepEqual([...UNI_COLUMNS], ['tv', 'receiver'])
    assert.deepEqual(UNI_COLUMNS.map((c) => UNI_COLUMN_TITLE[c]), ['Samsung', 'Marantz'])
    assert.deepEqual([...new Set(UNI_RECEIVER.map((b) => b.source))], ['receiver'])
    assert.deepEqual([...new Set(UNI_TV.map((b) => b.source))], ['tv', 'scene', 'switch'])
  })
  it('левый столбец: питание, громкость, Mute, источник, каналы, стрелки с ENTER, RETURN/EXIT/MENU/INFO, play/pause', () => {
    const h = html({ buttons: UNI_TV })
    for (const id of ['tv-power', 'tv-source', 'tv-vol-up', 'tv-vol-down', 'tv-mute', 'tv-ch-up', 'tv-ch-down', 'tv-up', 'tv-down', 'tv-left', 'tv-right', 'tv-enter', 'tv-return', 'tv-exit', 'tv-menu', 'tv-info', 'tv-play', 'tv-pause']) {
      assert.ok(h.includes(`data-tile="${id}"`), id)
    }
  })
  it('правый столбец: питание, громкость, Mute, входы живого списка, режимы звука и Smart Select 1–4', () => {
    const h = html({ buttons: UNI_RECEIVER })
    for (const id of ['av-power', 'av-vol-up', 'av-vol-down', 'av-mute']) assert.ok(h.includes(`data-tile="${id}"`), id)
    assert.equal((h.match(/data-tile="av-in-/g) ?? []).length, 3)
    assert.equal((h.match(/data-tile="av-sm-/g) ?? []).length, 4)
    assert.equal((h.match(/data-tile="av-ss-/g) ?? []).length, 4)
    assert.ok(h.includes('Pure Direct') && h.includes('Movie') && h.includes('Music') && h.includes('Game'))
  })
  it('команда плитки видна в разметке, подписи — свои', () => {
    assert.match(html({ buttons: UNI_RECEIVER }), /data-tile="av-vol-up" data-command="MVUP"/)
    assert.match(html({ buttons: UNI_TV }), /data-tile="tv-enter" data-command="KEY_ENTER"/)
    assert.ok(html({ buttons: UNI_RECEIVER }).includes('Громче'))
  })
  it('серые: вход не из живого списка, кнопка без команды, сцена недоступна', () => {
    const h = html({ buttons: UNI_RECEIVER })
    assert.equal(state(h, 'av-in-tv'), 'on')
    assert.equal(state(h, 'av-in-satcbl'), 'off') // такого входа нет в списке ресивера
    assert.match(h, /ANDROID — такого входа нет в списке ресивера/)
    const noCmd: UniButtonView = { ...UNI_RECEIVER[1], id: 'uni-x', resolved: null, available: false, title: 'без команды' }
    const offScene: UniButtonView = { ...UNI_TV.find((b) => b.source === 'scene')!, id: 'uni-y', available: false }
    const h2 = html({ buttons: [noCmd, offScene] })
    assert.equal(state(h2, 'uni-x'), 'off')
    assert.equal(state(h2, 'uni-y'), 'off')
    assert.match(h2, /команда не назначена/)
    assert.match(h2, /сцена недоступна/)
  })
  it('выключенный ресивер и молчащий ТВ: активны только питание', () => {
    const off = { receiver: { ...RECEIVER_ON, power: 'STANDBY' as const }, tv: { ...TV_ON, online: false } }
    const hr = html({ buttons: UNI_RECEIVER, st: off })
    const ht = html({ buttons: UNI_TV, st: off })
    assert.equal(state(hr, 'av-power'), 'on')
    assert.equal(state(ht, 'tv-power'), 'on') // ТВ включит сцена
    assert.equal(state(hr, 'av-vol-up'), 'off')
    assert.equal(state(ht, 'tv-up'), 'off')
  })
  it('режим «Изменить»: у каждой плитки меню действий, нажатие не шлёт команду', () => {
    const h = html({ buttons: UNI_TV, editing: true })
    assert.equal((h.match(/data-state="edit"/g) ?? []).length, UNI_TV.length)
    assert.equal((h.match(/Действия с кнопкой/g) ?? []).length, UNI_TV.length)
    assert.ok(!html({ buttons: UNI_TV }).includes('Действия с кнопкой'))
  })
  it('пустой пульт подсказывает, что делать', () => {
    assert.match(html({ buttons: [] }), /Кнопок нет/)
  })
})

describe('универсальный пульт: плитки-выключатели', () => {
  it('включённый — залит цветом и «вкл», выключенный — приглушён и «выкл»', () => {
    const h = html({ buttons: [sw('sw-tv-socket'), sw('sw-balcon')] })
    assert.match(h, /data-tile="sw-tv-socket"[^>]*data-switch="on"/)
    assert.match(h, /data-tile="sw-balcon"[^>]*data-switch="off"/)
    assert.equal(state(h, 'sw-tv-socket'), 'on')
    assert.equal(state(h, 'sw-balcon'), 'on') // нажимается: «выключен» — это состояние реле, а не плитки
    assert.ok(tile(h, 'sw-tv-socket').includes('bg-fuchsia-600'))
    assert.ok(tile(h, 'sw-balcon').includes('bg-muted')) // приглушённая
    assert.match(h, /Розетка ТВ<\/span><span[^>]*>вкл</)
    assert.match(h, /Балкон<\/span><span[^>]*>выкл</)
    assert.match(tile(h, 'sw-tv-socket'), /aria-pressed="true"/)
    assert.match(tile(h, 'sw-balcon'), /aria-pressed="false"/)
  })
  it('недоступный — серый и неактивный', () => {
    const h = html({ buttons: [sw('sw-lamp')] })
    assert.equal(state(h, 'sw-lamp'), 'off')
    assert.match(tile(h, 'sw-lamp'), /aria-disabled="true"/)
    assert.match(h, /выключатель недоступен/)
    assert.deepEqual(uniStatus(sw('sw-lamp'), st), { enabled: false, reason: 'выключатель недоступен' })
  })
  it('пока состояний нет — берётся доступность с сервера', () => {
    const bare = { receiver: RECEIVER_ON, tv: TV_ON }
    assert.equal(uniSwitchState(sw('sw-balcon'), bare), 'unknown')
    assert.equal(uniStatus(sw('sw-balcon'), bare).enabled, true)
    assert.equal(uniSwitchState({ ...sw('sw-balcon'), available: false }, bare), 'unavailable')
  })
  it('пока запрос в полёте, плитка заблокирована', () => {
    const h = html({ buttons: [sw('sw-tv-socket')], busy: new Set([sw('sw-tv-socket').resolved!]) })
    assert.match(tile(h, 'sw-tv-socket'), /aria-disabled="true"/)
    assert.match(h, /animate-spin/)
  })
  it('в режиме «Изменить» состояние не показывается, плитка открывает правку', () => {
    const h = html({ buttons: [sw('sw-tv-socket')], editing: true })
    assert.equal(state(h, 'sw-tv-socket'), 'edit')
    assert.ok(!/>вкл</.test(h))
    assert.match(h, /Действия с кнопкой/)
  })
})

describe('универсальный пульт: переключение выключателя', () => {
  const data = (state: 'on' | 'off' | 'unavailable'): SmartHomeData =>
    ({ devices: [{ id: 1, name: 'SonOff', ha: { controls: [{ entityId: 'switch.sonoff_sonoff_100094626b_1', name: 'Balcon', state }], summary: { text: 'выключено', tone: 'off', extras: [] } } }], hidden: [], groups: [], scenes: [], ha: {}, now: 0 }) as unknown as SmartHomeData
  const entity = 'switch.sonoff_sonoff_100094626b_1'

  it('ответ сервера подставляется сразу (без ожидания опроса)', async () => {
    let cache = data('off')
    const seen: string[] = []
    const r = await performToggle(
      {
        get: () => cache,
        set: (d) => (cache = d),
        post: async (id, action) => {
          seen.push(`${id}:${action}`)
          return { state: 'on', confirmed: true }
        },
      },
      entity,
      true,
    )
    assert.deepEqual(seen, [`${entity}:on`])
    assert.equal(r.state, 'on')
    assert.equal(cache.devices[0].ha?.controls?.[0].state, 'on')
  })
  it('при ошибке состояние откатывается, ошибка пробрасывается для toast', async () => {
    let cache = data('on')
    await assert.rejects(
      performToggle(
        {
          get: () => cache,
          set: (d) => (cache = d),
          post: async () => {
            throw new Error('Устройство недоступно')
          },
        },
        entity,
        false,
      ),
      /недоступно/,
    )
    assert.equal(cache.devices[0].ha?.controls?.[0].state, 'on') // как было
  })
  it('вкладка переключает на противоположное и ходит только в общий маршрут «Умного дома»', () => {
    const src = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')
    assert.match(src, /'\/smarthome\/ha\/toggle'/)
    assert.match(src, /performToggle\(/)
    assert.match(src, /controlStateOf\(qc\.getQueryData<SmartHomeData>\(key\), entityId\) !== 'on'/)
    assert.match(src, /refetchInterval: 3000/)
    assert.ok(!/ConfirmDialog|вы уверены/i.test(src)) // подтверждений нет
    assert.equal(withControlState(data('off'), entity, 'on').devices[0].ha?.controls?.[0].state, 'on')
  })
})

describe('универсальный пульт: правка состава', () => {
  const list = UNI_TV.map(stripView)
  it('добавление кладёт плитку в конец, правка — на место', () => {
    const fresh = draftButton('tv', { command: 'num-1', title: 'Цифра 1' }, list)
    const added = upsertButton(list, fresh)
    assert.equal(added.length, list.length + 1)
    assert.equal(added.at(-1)?.command, 'num-1')
    const renamed = upsertButton(added, { ...fresh, label: 'Первый канал' })
    assert.equal(renamed.length, added.length)
    assert.equal(renamed.at(-1)?.label, 'Первый канал')
  })
  it('удаление убирает одну плитку и не трогает остальные', () => {
    const left = removeButton(list, 'tv-mute')
    assert.equal(left.length, list.length - 1)
    assert.ok(!left.some((b) => b.id === 'tv-mute'))
    assert.deepEqual(removeButton(list, 'нет-такой'), list)
  })
  it('в справочнике добавления — кнопки обоих пультов, сцены и выключатели', () => {
    assert.ok(UNI_DATA.catalog.receiver.length > 0 && UNI_DATA.catalog.tv.length > 0 && UNI_DATA.catalog.scenes.length > 0)
    assert.ok(UNI_DATA.catalog.switches.length > 0)
    assert.deepEqual(UNI_DATA.catalog.switches.map((x) => x.title), ['Balcon', 'Lamp', 'TV  &  MARANTZ', 'ML'])
  })
  it('диалог «Добавить кнопку»: четвёртый источник «Выключатели» с поиском по каналу и устройству', () => {
    const src = readFileSync(new URL('./dialogs.tsx', import.meta.url), 'utf8')
    assert.match(src, /\['receiver', 'tv', 'scene', 'switch'\] as const/)
    assert.match(src, /catalog\.switches/)
    assert.equal(SOURCE_LABEL.switch, 'Выключатели')
    assert.deepEqual(filterItems(UNI_DATA.catalog.switches, 'balcon').map((x) => x.command), ['switch.sonoff_sonoff_100094626b_1'])
    assert.deepEqual(filterItems(UNI_DATA.catalog.switches, 'люстра').map((x) => x.command), ['light.ml']) // по имени устройства
    assert.equal(filterItems(UNI_DATA.catalog.switches, 'marantz').length, 1)
    assert.equal(filterItems(UNI_DATA.catalog.switches, '').length, UNI_DATA.catalog.switches.length)
  })
  it('новая плитка-выключатель: значок вилки у розетки, лампочка у света', () => {
    const socket = draftButton('switch', { command: 'switch.tv_marantz_sonoff_1000d31d6d', title: 'TV  &  MARANTZ' }, [])
    assert.equal(socket.icon, 'socket')
    assert.equal(socket.source, 'switch')
    assert.equal(draftButton('switch', { command: 'light.lamp', title: 'Лампа' }, []).icon, 'lightbulb')
  })
  it('столбцы правятся независимо: свой переключатель, своё добавление и свой сброс', () => {
    const src = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')
    assert.match(src, /api\.put<UniData>\(`\/universal\/remote\/\$\{v\.column\}`, \{ buttons: v\.buttons \}\)/)
    assert.match(src, /api\.post<UniData>\(`\/universal\/remote\/\$\{column\}\/reset`\)/)
    assert.match(src, /universal-edit-\$\{column\}/) // у каждого столбца свой переключатель «Изменить»
    assert.match(src, /defaultSource=\{column\}/) // диалог предлагает кнопки своего устройства
    assert.match(src, /UNI_COLUMNS\.map/)
    assert.match(src, /md:grid-cols-2/) // на узком экране столбцы идут друг под другом
  })
  it('вкладка сохраняет только модель кнопки и шлёт команды прежними маршрутами', () => {
    const src = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')
    assert.match(src, /buttons\.map\(stripView\)/)
    assert.match(src, /send\(b\.resolved/)
    assert.match(src, /tvPress\(b\.id, b\.resolved\)/)
    assert.match(src, /'\/smarthome\/ha\/scene'/)
    assert.ok(!/api\.post\('\/receiver/.test(src))
  })
})
