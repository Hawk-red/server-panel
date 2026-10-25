import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyOrder } from './layout-order.ts'
import { RECEIVER_BLOCKS, RECEIVER_GRID_BLOCKS, RECEIVER_LAYOUT_PAGE } from './receiver-layout.ts'
import { sidebarData } from '../components/layout/data/sidebar-data.ts'

const here = (p: string) => new URL(p, import.meta.url)

describe('страница «Ресивер»: блоки', () => {
  it('порядок по умолчанию и уникальные id, допустимые серверу (a-z0-9-, до 40)', () => {
    assert.deepEqual(RECEIVER_BLOCKS.map((b) => b.id), ['volume', 'inputs', 'modes', 'quick', 'nav', 'sound', 'links'])
    assert.equal(new Set(RECEIVER_BLOCKS.map((b) => b.id)).size, RECEIVER_BLOCKS.length)
    for (const b of RECEIVER_BLOCKS) assert.match(b.id, /^[a-z0-9-]{1,40}$/)
  })
  it('блока power нет: 6 блоков сетки и блок ссылок последним', () => {
    assert.ok(!RECEIVER_BLOCKS.some((b) => b.id === 'power'))
    assert.deepEqual(RECEIVER_GRID_BLOCKS.map((b) => b.id), ['volume', 'inputs', 'modes', 'quick', 'nav', 'sound'])
    assert.equal(RECEIVER_BLOCKS.at(-1)?.id, 'links')
    assert.ok(!/id: 'power'/.test(readFileSync(here('../features/receiver/index.tsx'), 'utf8')))
  })
  it('старый сохранённый порядок с power не ломается: power игнорируется, остальные на местах', () => {
    const r = applyOrder(RECEIVER_BLOCKS.map((b) => ({ id: b.id })), ['power', 'nav', 'volume', 'links']).map((b) => b.id)
    assert.deepEqual(r, ['nav', 'volume', 'links', 'inputs', 'modes', 'quick', 'sound'])
  })
  it('ключ порядка — receiver (на сервере layout.receiver) и проходит проверку имени страницы', () => {
    assert.equal(RECEIVER_LAYOUT_PAGE, 'receiver')
    assert.match(RECEIVER_LAYOUT_PAGE, /^[a-z0-9-]{1,30}$/)
  })
  it('код блоков с теми же id на месте, но в навигации их больше нет', () => {
    const src = readFileSync(here('../features/receiver/index.tsx'), 'utf8')
    assert.match(src, /SortableBlocks/)
    for (const b of RECEIVER_BLOCKS) assert.ok(src.includes(`id: '${b.id}'`), b.id)
    // Вкладки «Ресивер» (блоками) на странице «Медиа» нет, поэтому ключ порядка она больше не ставит
    const hub = readFileSync(here('../features/media-hub/index.tsx'), 'utf8')
    assert.doesNotMatch(hub, /layoutPage=/)
  })
})

describe('кнопка питания', () => {
  const src = readFileSync(here('../features/receiver/index.tsx'), 'utf8')
  it('диалога подтверждения выключения нет, PWSTANDBY уходит сразу', () => {
    assert.doesNotMatch(src, /ConfirmDialog|Выключить ресивер\?/)
    assert.match(src, /send\(on \? 'PWSTANDBY' : 'PWON'\)/)
  })
  it('красная только при подтверждённом standby, зелёная при включённом, иначе серая', () => {
    assert.match(src, /standby && 'bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500'/)
    assert.match(src, /on && 'bg-emerald-700/)
    assert.match(src, /!on && !standby && 'bg-muted/)
  })
  it('кнопка заблокирована, пока идёт любая команда, и без данных о питании', () => {
    assert.match(src, /disabled=\{\(!on && !standby\) \|\| pending !== null\}/)
  })
  it('подсказки: «Включить ресивер» в standby, «Выключить ресивер» при включённом', () => {
    assert.match(src, /on \? 'Выключить ресивер' : standby \? 'Включить ресивер'/)
  })
})

describe('главное меню: «Медиа» и «Медиа-серверы»', () => {
  const all = sidebarData.navGroups.flatMap((g) => g.items.map((i) => ({ group: g.title, i })))
  it('отдельного пункта «Ресивер» нет', () => {
    assert.ok(!all.some((x) => x.i.url === '/receiver' || x.i.title === 'Ресивер'))
  })
  it('«Медиа» (/media-control, со значком) стоит первым в «Сервисы», сразу за ним «Медиа-серверы» (/media)', () => {
    const items = sidebarData.navGroups.find((g) => g.title === 'Сервисы')!.items
    assert.equal(items[0].url, '/media-control')
    assert.equal(items[0].title, 'Медиа')
    assert.ok(items[0].icon)
    assert.equal(items[1].url, '/media')
    assert.equal(items[1].title, 'Медиа-серверы')
  })
  it('«Умный дом» на месте, сразу за ним «Home Assistant»', () => {
    const items = sidebarData.navGroups.find((g) => g.title === 'Сервисы')!.items
    const i = items.findIndex((x) => x.url === '/smarthome')
    assert.ok(i >= 0 && items[i].title === 'Умный дом')
    assert.equal(items[i + 1].url, '/homeassistant')
    assert.equal(items[i + 1].title, 'Home Assistant')
    assert.ok(items[i + 1].icon)
  })
  it('адреса пунктов уникальны (меню не ломается дублем)', () => {
    const urls = all.map((x) => x.i.url)
    assert.equal(new Set(urls).size, urls.length)
  })
  it('страница серверов называется «Медиа-серверы», маршрут /media прежний', () => {
    assert.match(readFileSync(here('../features/media/index.tsx'), 'utf8'), /<Page title='Медиа-серверы'/)
    assert.match(readFileSync(here('../routes/_authenticated/media/index.tsx'), 'utf8'), /'\/_authenticated\/media\/'/)
  })
})

describe('редиректы старых адресов', () => {
  it('/receiver ведёт на /media-control с переносом вкладки, /media/remote — на «Marantz»', () => {
    const r = readFileSync(here('../routes/_authenticated/receiver/index.tsx'), 'utf8')
    assert.match(r, /redirect\(\{ to: '\/media-control', search: \{ tab: legacyReceiverTab\(search\.tab\) \}/)
    const old = readFileSync(here('../routes/_authenticated/media/remote.tsx'), 'utf8')
    assert.match(old, /to: '\/media-control', search: \{ tab: 'marantz' \}/)
    const tree = readFileSync(here('../routeTree.gen.ts'), 'utf8')
    assert.match(tree, /'\/_authenticated\/receiver\/'/)
    assert.match(tree, /'\/_authenticated\/media-control\/'/)
  })
  it('внутренних ссылок на /receiver и /media/remote не осталось', () => {
    for (const f of ['../features/media/index.tsx', '../features/receiver/index.tsx', '../features/media-hub/index.tsx', '../lib/palette.ts', '../components/layout/data/sidebar-data.ts']) {
      const t = readFileSync(here(f), 'utf8')
      assert.doesNotMatch(t, /media\/remote/, f)
      assert.doesNotMatch(t, /to: '\/receiver'|url: '\/receiver'|to='\/receiver'/, f)
    }
  })
})
