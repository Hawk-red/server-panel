/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Универсальный пульт на мок-данных: начальный набор, серые плитки, режим «Изменить», добавление и удаление.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { removeButton, stripView, upsertButton, draftButton, type UniButtonView } from '@/lib/universal-pad'
import { UniversalPad } from './universal-pad'
import { RECEIVER_ON, TV_ON, UNI_BUTTONS, UNI_DATA } from './universal-mock'

const noop = () => {}
const st = { receiver: RECEIVER_ON, tv: TV_ON }
const html = (over: { buttons?: UniButtonView[]; editing?: boolean; st?: typeof st } = {}) =>
  renderToStaticMarkup(<UniversalPad buttons={over.buttons ?? UNI_BUTTONS} st={over.st ?? st} editing={over.editing ?? false} onPress={noop} onEdit={noop} onRemove={noop} />)
const state = (h: string, id: string) => new RegExp(`data-tile="${id}"[^>]*data-state="(\\w+)"`).exec(h)?.[1]

describe('универсальный пульт: сетка плиток', () => {
  it('начальный набор: питание обоих устройств, громкость ресивера, навигация ТВ, входы и режимы', () => {
    const h = html()
    for (const id of ['tv-power', 'av-power', 'av-vol-up', 'av-vol-down', 'av-mute', 'tv-up', 'tv-down', 'tv-left', 'tv-right', 'tv-enter', 'tv-return', 'tv-exit', 'tv-menu']) {
      assert.ok(h.includes(`data-tile="${id}"`), id)
    }
    assert.equal((h.match(/data-tile="av-in-/g) ?? []).length, 3)
    assert.equal((h.match(/data-tile="av-sm-/g) ?? []).length, 4)
    assert.ok(h.includes('Pure Direct') && h.includes('Movie') && h.includes('Music') && h.includes('Game'))
  })
  it('команда плитки видна в разметке, подписи — свои', () => {
    const h = html()
    assert.match(h, /data-tile="av-vol-up" data-command="MVUP"/)
    assert.match(h, /data-tile="tv-enter" data-command="KEY_ENTER"/)
    assert.ok(h.includes('Громче') && h.includes('OK'))
  })
  it('серые: вход не из живого списка, кнопка без команды, сцена недоступна', () => {
    const h = html()
    assert.equal(state(h, 'av-in-tv'), 'on')
    assert.equal(state(h, 'av-in-cblsat'), 'off') // такого входа нет в списке ресивера
    assert.match(h, /Вход CBL\/SAT — такого входа нет в списке ресивера/)
    const noCmd: UniButtonView = { ...UNI_BUTTONS[2], id: 'uni-x', resolved: null, available: false, title: 'без команды' }
    const offScene: UniButtonView = { ...UNI_BUTTONS[20], id: 'uni-y', available: false }
    const h2 = html({ buttons: [noCmd, offScene] })
    assert.equal(state(h2, 'uni-x'), 'off')
    assert.equal(state(h2, 'uni-y'), 'off')
    assert.match(h2, /команда не назначена/)
    assert.match(h2, /сцена недоступна/)
  })
  it('выключенный ресивер и молчащий ТВ: активны только питание', () => {
    const h = html({ st: { receiver: { ...RECEIVER_ON, power: 'STANDBY' }, tv: { ...TV_ON, online: false } } })
    assert.equal(state(h, 'av-power'), 'on')
    assert.equal(state(h, 'tv-power'), 'on') // ТВ включит сцена
    assert.equal(state(h, 'av-vol-up'), 'off')
    assert.equal(state(h, 'tv-up'), 'off')
  })
  it('режим «Изменить»: у каждой плитки меню действий, нажатие не шлёт команду', () => {
    const h = html({ editing: true })
    assert.equal((h.match(/data-state="edit"/g) ?? []).length, UNI_BUTTONS.length)
    assert.equal((h.match(/Действия с кнопкой/g) ?? []).length, UNI_BUTTONS.length)
    assert.ok(!html().includes('Действия с кнопкой'))
  })
  it('пустой пульт подсказывает, что делать', () => {
    assert.match(html({ buttons: [] }), /Кнопок нет/)
  })
})

describe('универсальный пульт: правка состава', () => {
  const list = UNI_BUTTONS.map(stripView)
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
    const left = removeButton(list, 'av-mute')
    assert.equal(left.length, list.length - 1)
    assert.ok(!left.some((b) => b.id === 'av-mute'))
    assert.deepEqual(removeButton(list, 'нет-такой'), list)
  })
  it('в справочнике добавления — кнопки обоих пультов и сцены', () => {
    assert.ok(UNI_DATA.catalog.receiver.length > 0 && UNI_DATA.catalog.tv.length > 0 && UNI_DATA.catalog.scenes.length > 0)
  })
  it('вкладка сохраняет весь список целиком и только модель кнопки', () => {
    const src = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')
    assert.match(src, /api\.put<UniData>\('\/universal\/remote', \{ buttons \}\)/)
    assert.match(src, /buttons\.map\(stripView\)/)
    // команды уходят прежними маршрутами, своих способов управления нет
    assert.match(src, /send\(b\.resolved/)
    assert.match(src, /tvPress\(b\.id, b\.resolved\)/)
    assert.match(src, /'\/smarthome\/ha\/scene'/)
    assert.ok(!/api\.post\('\/receiver/.test(src))
  })
})
