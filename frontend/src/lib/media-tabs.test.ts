import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isMediaTab, legacyReceiverTab, MEDIA_TABS, MEDIA_TAB_TITLES, parseMediaTab } from './media-tabs.ts'

describe('вкладки страницы «Медиа»', () => {
  it('ровно три вкладки в заданном порядке с названиями', () => {
    assert.deepEqual([...MEDIA_TABS], ['universal', 'samsung', 'marantz'])
    assert.deepEqual(MEDIA_TABS.map((t) => MEDIA_TAB_TITLES[t]), ['UNIVERSAL', 'TV', 'MARANTZ'])
  })
  it('?tab= разбирается; неизвестное и мусор → «Универсальный»', () => {
    for (const t of MEDIA_TABS) assert.equal(parseMediaTab(t), t)
    for (const v of [undefined, null, '', 'x', 'TV', 42, {}, '__proto__', 'toString', 'tv ']) assert.equal(parseMediaTab(v), 'universal')
    assert.equal(isMediaTab('samsung'), true)
    assert.equal(isMediaTab('tv'), false)
  })
  it('прежние вкладки: ТВ → «Samsung», ресиверные → «Marantz»', () => {
    for (const v of ['tv', 'tv-remote']) assert.equal(parseMediaTab(v), 'samsung', v)
    for (const v of ['receiver', 'receiver-remote', 'remote', 'control']) assert.equal(parseMediaTab(v), 'marantz', v)
  })
  it('старый /receiver без ?tab= → «Marantz»', () => {
    assert.equal(legacyReceiverTab(undefined), 'marantz')
    assert.equal(legacyReceiverTab(''), 'marantz')
    assert.equal(legacyReceiverTab('remote'), 'marantz')
    assert.equal(legacyReceiverTab('tv-remote'), 'samsung')
    assert.equal(legacyReceiverTab('мусор'), 'universal')
  })
})

import { readFileSync } from 'node:fs'
describe('страница «Медиа»: состав вкладок', () => {
  const hub = readFileSync(new URL('../features/media-hub/index.tsx', import.meta.url), 'utf8')
  it('каждая вкладка показывает своё содержимое, выбор пишется в адрес (?tab=)', () => {
    for (const v of ["value='universal'", "value='samsung'", "value='marantz'"]) assert.ok(hub.includes(`<TabsContent ${v}>`), v)
    assert.match(hub, /<UniversalTab \/>/)
    assert.match(hub, /<SamsungTab \/>/)
    assert.match(hub, /<MarantzTab \/>/)
    assert.match(hub, /navigate\(\{ to: '\/media-control', search: \{ tab: t as MediaTab \}, replace: true \}\)/)
  })
  it('убранные вкладки в навигации не показываются', () => {
    for (const v of ["value='receiver'", "value='tv'", "value='receiver-remote'", "value='tv-remote'"]) assert.equal(hub.includes(`<TabsContent ${v}>`), false, v)
  })
  it('маршрут /media-control берёт вкладку из ?tab=', () => {
    const r = readFileSync(new URL('../routes/_authenticated/media-control/index.tsx', import.meta.url), 'utf8')
    assert.match(r, /validateSearch/)
    assert.match(r, /parseMediaTab\(s\.tab\)/)
  })
  it('старые адреса страниц ведут на новые вкладки', () => {
    const recv = readFileSync(new URL('../routes/_authenticated/receiver/index.tsx', import.meta.url), 'utf8')
    assert.match(recv, /redirect\(\{ to: '\/media-control', search: \{ tab: legacyReceiverTab\(search\.tab\) \}/)
    const rem = readFileSync(new URL('../routes/_authenticated/media/remote.tsx', import.meta.url), 'utf8')
    assert.match(rem, /search: \{ tab: 'marantz' \}/)
  })
})
