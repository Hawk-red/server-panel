import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isMediaTab, legacyReceiverTab, MEDIA_TABS, MEDIA_TAB_TITLES, parseMediaTab } from './media-tabs.ts'

describe('вкладки страницы «Медиа»', () => {
  it('пять вкладок в заданном порядке с названиями', () => {
    assert.deepEqual([...MEDIA_TABS], ['receiver', 'tv', 'receiver-remote', 'tv-remote', 'universal'])
    assert.deepEqual(MEDIA_TABS.map((t) => MEDIA_TAB_TITLES[t]), ['Ресивер', 'Телевизор', 'Пульт ресивера', 'Пульт ТВ', 'Универсальный'])
  })
  it('?tab= разбирается; неизвестное и мусор → «Ресивер»', () => {
    for (const t of MEDIA_TABS) assert.equal(parseMediaTab(t), t)
    for (const v of [undefined, null, '', 'x', 'TV', 42, {}, '__proto__', 'tv ']) assert.equal(parseMediaTab(v), 'receiver')
    assert.equal(isMediaTab('tv'), true)
    assert.equal(isMediaTab('toString'), false)
  })
  it('старый /receiver?tab=remote → «Пульт ресивера», без tab → «Ресивер»', () => {
    assert.equal(legacyReceiverTab('remote'), 'receiver-remote')
    assert.equal(legacyReceiverTab(undefined), 'receiver')
    assert.equal(legacyReceiverTab('control'), 'receiver')
    assert.equal(legacyReceiverTab('tv-remote'), 'tv-remote')
  })
})

import { readFileSync } from 'node:fs'
describe('страница «Медиа»: состав вкладок', () => {
  const hub = readFileSync(new URL('../features/media-hub/index.tsx', import.meta.url), 'utf8')
  it('все четыре вкладки показывают свой контент, выбор пишется в адрес (?tab=)', () => {
    for (const v of ["value='receiver'", "value='tv'", "value='receiver-remote'", "value='tv-remote'", "value='universal'"]) assert.ok(hub.includes(`<TabsContent ${v}>`), v)
    assert.match(hub, /<ReceiverSection view='control' \/>/)
    assert.match(hub, /<ReceiverSection view='remote' \/>/)
    assert.match(hub, /<TvTab \/>/)
    assert.match(hub, /<TvRemoteTab \/>/)
    assert.match(hub, /<UniversalTab \/>/)
    assert.match(hub, /navigate\(\{ to: '\/media-control', search: \{ tab: t as MediaTab \}, replace: true \}\)/)
  })
  it('маршрут /media-control берёт вкладку из ?tab=', () => {
    const r = readFileSync(new URL('../routes/_authenticated/media-control/index.tsx', import.meta.url), 'utf8')
    assert.match(r, /validateSearch/)
    assert.match(r, /parseMediaTab\(s\.tab\)/)
  })
})
