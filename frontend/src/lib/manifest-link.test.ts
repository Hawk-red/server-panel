import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MANIFEST_PATH, PANEL_NAME, manifestHref, pageName, startPath, type NavTitle } from './manifest-link.js'

const NAV: NavTitle[] = [
  { url: '/', title: 'Обзор' },
  { url: '/disks', title: 'Диски' },
  { url: '/media-control', title: 'ПУЛЬТ' },
  { url: '/network', title: 'Сеть и устройства' },
]

describe('startPath', () => {
  it('склеивает путь с параметрами', () => {
    assert.equal(startPath('/disks', ''), '/disks')
    assert.equal(startPath('/media-control', '?tab=marantz'), '/media-control?tab=marantz')
    assert.equal(startPath('/media-control', 'tab=marantz'), '/media-control?tab=marantz')
    assert.equal(startPath('/', ''), '/')
  })
  it('не внутренний адрес заменяет на «/» (safeRedirect)', () => {
    assert.equal(startPath('//evil.com', ''), '/')
    assert.equal(startPath('/\\evil.com', ''), '/')
    assert.equal(startPath('https://evil.com', ''), '/')
  })
})

describe('pageName', () => {
  it('берёт заголовок раздела по адресу', () => {
    assert.equal(pageName('/', '', NAV), 'Обзор')
    assert.equal(pageName('/disks', '', NAV), 'Диски')
    assert.equal(pageName('/network', '?tab=devices', NAV), 'Сеть и устройства')
  })
  it('у «ПУЛЬТ» универсальный пульт — «Пульт», остальные вкладки — заголовок страницы', () => {
    assert.equal(pageName('/media-control', '?tab=universal', NAV), 'Пульт')
    assert.equal(pageName('/media-control', '', NAV), 'Пульт') // вкладка по умолчанию
    assert.equal(pageName('/media-control', '?tab=samsung', NAV), 'ПУЛЬТ')
    assert.equal(pageName('/media-control', '?tab=marantz', NAV), 'ПУЛЬТ')
  })
  it('страницы вне сайдбара — имя панели', () => {
    assert.equal(pageName('/sign-in', '', NAV), PANEL_NAME)
    assert.equal(pageName('/tv/system', '', NAV), PANEL_NAME)
  })
})

describe('manifestHref', () => {
  it('адрес манифеста с путём и именем страницы', () => {
    assert.equal(manifestHref('/disks', '', 'Диски'), `${MANIFEST_PATH}?start=%2Fdisks&name=%D0%94%D0%B8%D1%81%D0%BA%D0%B8`)
    const href = manifestHref('/media-control', '?tab=universal', 'Пульт')
    const q = new URLSearchParams(href.slice(href.indexOf('?') + 1))
    assert.equal(q.get('start'), '/media-control?tab=universal')
    assert.equal(q.get('name'), 'Пульт')
  })
  it('внешний адрес в start не попадает', () => {
    const q = new URLSearchParams(manifestHref('//evil.com', '', 'X').split('?')[1])
    assert.equal(q.get('start'), '/')
  })
})
