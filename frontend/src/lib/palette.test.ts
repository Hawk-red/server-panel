import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildPaletteItems, filterPaletteItems, paletteFilter, type PaletteData } from './palette.ts'
import type { Device, MediaData, NetworkData } from './types.ts'
import { sidebarData } from '../components/layout/data/sidebar-data.ts'

// Моки: устройство «Marantz NR1604» из «Сети и устройств» и данные страницы «Медиа» (ресивер не в сети)
const marantz = { mac: 'aa:bb:cc:00:00:94', ip: '192.168.31.94', vendor: 'D&M Holdings Inc.', hostname: 'Marantz', name: 'Marantz NR1604', type: 'media', location: null, note: null } as unknown as Device
const other = { mac: 'aa:bb:cc:00:00:01', ip: '192.168.31.50', vendor: 'Apple, Inc.', hostname: 'macbook-pro-ha', name: null, type: 'computer', location: 'кабинет', note: null } as unknown as Device
const network = { devices: [marantz, other], summary: { total: 2, online: 1, unknown: 0 }, status: {} } as unknown as NetworkData
const ok = <T>(data: T) => ({ data, error: null }) as const
const media = {
  jellyfin: { container: ok({ name: 'jellyfin' }), info: ok({ version: '12.1.0', name: 'Jellyfin' }), sessions: ok([]) },
  minimserver: { container: ok({ name: 'minimserver' }) },
  bubbleupnpserver: { container: ok({ name: 'bubbleupnpserver' }) },
  marantz: ok({ host: '192.168.31.94', webPort: 8080, online: false, power: null, source: null }),
} as unknown as MediaData
const data: PaletteData = { network, media }

const titles = (q: string, d: PaletteData = data) => filterPaletteItems(buildPaletteItems(d), q).map((i) => `${i.group}:${i.title}`)

describe('палитра ⌘K: устройство Marantz NR1604', () => {
  for (const q of ['marantz', 'марантз', 'NR1604', 'nr1604', '192.168.31.94', 'vfhfynp']) {
    it(`«${q}» находит устройство сети и карточку «Медиа»`, () => {
      const r = titles(q)
      assert.ok(r.includes('devices:Marantz NR1604'), `devices: ${r.join(' | ')}`)
      assert.ok(r.includes('media:Marantz NR1604'), `media: ${r.join(' | ')}`)
    })
  }
  it('производитель «D&M Holdings» находит устройство сети', () => assert.ok(titles('D&M Holdings').includes('devices:Marantz NR1604')))
  it('чужие устройства не попадают в выдачу', () => {
    assert.ok(!titles('marantz').includes('devices:macbook-pro-ha'))
    assert.ok(titles('кабинет').includes('devices:macbook-pro-ha'))
  })
  it('поиск по сетевому имени (hostname) без name', () => {
    const d: PaletteData = { network: { ...network, devices: [{ ...marantz, name: null }] } }
    assert.ok(titles('marantz', d).includes('devices:Marantz'))
  })
  it('выбор только переходит на страницу (без действий)', () => {
    const items = buildPaletteItems(data).filter((i) => /marantz/i.test(i.title))
    assert.deepEqual(items.map((i) => i.to).sort(), ['/media', '/network'])
  })
})

describe('палитра ⌘K: раздел «Медиа»', () => {
  it('карточки Jellyfin, MinimServer, BubbleUPnP Server, Marantz находятся по названию, описанию и IP', () => {
    assert.ok(titles('jellyfin').includes('media:Jellyfin'))
    assert.ok(titles('джеллифин').includes('media:Jellyfin'))
    assert.ok(titles('minim').includes('media:MinimServer'))
    assert.ok(titles('bubbleupnp').includes('media:BubbleUPnP Server'))
    assert.ok(titles('ресивер').includes('media:Marantz NR1604'))
    assert.ok(titles('192.168.31.94').includes('media:Marantz NR1604'))
  })
  it('карточки есть и пока /media ещё не загрузился (статические названия)', () => {
    assert.ok(titles('marantz', {}).includes('media:Marantz NR1604'))
  })
})

describe('фильтр cmdk: вызов filter(value, search, keywords)', () => {
  it('берёт запрос из аргумента search (а не из отстающего состояния) и считает 0…1', () => {
    const kw = ['Marantz NR1604', 'Marantz', 'D&M Holdings Inc.', '192.168.31.94']
    assert.ok(paletteFilter('device:aa', 'marantz', kw) > 0)
    assert.equal(paletteFilter('device:aa', 'plex', kw), 0) // другой запрос подряд — матчер пересоздаётся
    assert.ok(paletteFilter('device:aa', 'марантз', kw) > 0)
    assert.equal(paletteFilter('device:aa', '', kw), 1)
  })
})

// Разделы боковой панели так, как их отдаёт палитра: value = заголовок, keywords = [группа, адрес]
const navItems = sidebarData.navGroups.flatMap((g) => g.items.map((it) => ({ title: it.title, keywords: [g.title, String(it.url)] })))
const nav = (q: string) =>
  navItems
    .map((it) => ({ it, s: paletteFilter(it.title, q, it.keywords) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.it.title)

describe('палитра ⌘K: разделы и порядок выдачи', () => {
  it('«ssh» — только «SSH и доступ» (раньше «ыыр» фонетически находился внутри «Сервисы»)', () => {
    assert.deepEqual(nav('ssh'), ['SSH и доступ'])
    assert.deepEqual(nav('SSH'), ['SSH и доступ'])
  })
  it('двухбуквенный ключ не даёт совпадения по подстроке в другом алфавите', () => {
    assert.equal(paletteFilter('Медиа', 'ssh', ['Сервисы', '/media']), 0)
    assert.equal(paletteFilter('Медиа', 'ыыр', ['Сервисы', '/media']), 0)
  })
  it('раскладка и транслит разделов работают', () => {
    assert.equal(nav('ssh')[0], 'SSH и доступ')
    assert.equal(nav('ыыр')[0], 'SSH и доступ') // «ssh» в русской раскладке
    assert.equal(nav('торренты')[0], 'Торренты')
    assert.equal(nav('torrenty')[0], 'Торренты')
    assert.equal(nav('docker')[0], 'Docker')
  })
  it('точное или по началу слова в названии выше фонетики, опечаток и совпадений по описанию', () => {
    const exact = paletteFilter('media:x', 'jelly', ['Jelly bean', 'описание'])
    const prefixInTitle = paletteFilter('media:x', 'jelly', ['Jellyfin', ''])
    const phonetic = paletteFilter('media:x', 'джелли', ['Jellyfin', ''])
    const descOnly = paletteFilter('media:x', 'jelly', ['Другое', 'jellyfin описание'])
    const typo = paletteFilter('media:x', 'jellyfen', ['Jellyfin', ''])
    assert.ok(exact > 2 && prefixInTitle > 2)
    for (const lower of [phonetic, descOnly, typo]) assert.ok(prefixInTitle > lower, `${prefixInTitle} > ${lower}`)
  })
  it('группа с лучшим совпадением получает наибольшую оценку (cmdk ставит группы по максимуму)', () => {
    const items = buildPaletteItems({ ...data, services: [{ unit: 'ssh.service', description: 'OpenBSD Secure Shell server' } as never] })
    const best = (g: string) => Math.max(0, ...items.filter((i) => i.group === g).map((i) => paletteFilter(i.id, 'ssh', i.keywords)))
    assert.ok(best('services') > 2)
    assert.equal(best('media'), 0)
    assert.ok(best('services') > Math.max(...navItems.map((n) => paletteFilter(n.title, 'ssh', n.keywords)).filter((s) => s < 2), 0))
  })
  it('прежние запросы находят то же', () => {
    for (const q of ['marantz', 'марантз', 'vfhfynp']) assert.ok(titles(q).includes('media:Marantz NR1604'), q)
    assert.ok(titles('ipad', { network: { ...network, devices: [{ ...other, name: 'iPad Алины' } as Device] } }).includes('devices:iPad Алины'))
    assert.ok(titles('hummingbird', { network: { ...network, devices: [{ ...other, name: 'Колибри', hostname: 'Hummingbird' } as Device] } }).length > 0)
    assert.ok(titles('хаммингберд', { network: { ...network, devices: [{ ...other, name: null, hostname: 'Hummingbird' } as Device] } }).length > 0)
    assert.ok(titles('hummingbird', { network: { ...network, devices: [{ ...other, name: 'Хаммингберд' } as Device] } }).length > 0)
  })
})
