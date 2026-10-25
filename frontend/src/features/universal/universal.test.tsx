/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Универсальный пульт на мок-данных: два столбца, их начальные наборы, серые плитки, режим «Изменить», добавление и удаление.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { removeButton, stripView, upsertButton, draftButton, UNI_COLUMNS, UNI_COLUMN_TITLE, type UniButtonView } from '@/lib/universal-pad'
import { UniversalPad } from './universal-pad'
import { RECEIVER_ON, TV_ON, UNI_DATA, UNI_RECEIVER, UNI_TV } from './universal-mock'

const noop = () => {}
const st = { receiver: RECEIVER_ON, tv: TV_ON }
const html = (over: { buttons?: UniButtonView[]; editing?: boolean; st?: typeof st } = {}) =>
  renderToStaticMarkup(<UniversalPad buttons={over.buttons ?? UNI_TV} st={over.st ?? st} editing={over.editing ?? false} onPress={noop} onEdit={noop} onRemove={noop} />)
const state = (h: string, id: string) => new RegExp(`data-tile="${id}"[^>]*data-state="(\\w+)"`).exec(h)?.[1]

describe('универсальный пульт: два столбца', () => {
  it('столбцы называются Samsung и Marantz, слева ТВ, справа ресивер', () => {
    assert.deepEqual([...UNI_COLUMNS], ['tv', 'receiver'])
    assert.deepEqual(UNI_COLUMNS.map((c) => UNI_COLUMN_TITLE[c]), ['Samsung', 'Marantz'])
    assert.deepEqual([...new Set(UNI_RECEIVER.map((b) => b.source))], ['receiver'])
    assert.deepEqual([...new Set(UNI_TV.map((b) => b.source))], ['tv', 'scene'])
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
    const offScene: UniButtonView = { ...UNI_TV.at(-1)!, id: 'uni-y', available: false }
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
  it('в справочнике добавления — кнопки обоих пультов и сцены', () => {
    assert.ok(UNI_DATA.catalog.receiver.length > 0 && UNI_DATA.catalog.tv.length > 0 && UNI_DATA.catalog.scenes.length > 0)
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
