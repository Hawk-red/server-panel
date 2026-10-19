import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RECEIVER_BLOCKS, RECEIVER_LAYOUT_PAGE } from './receiver-layout.ts'
import { sidebarData } from '../components/layout/data/sidebar-data.ts'

const here = (p: string) => new URL(p, import.meta.url)

describe('страница «Ресивер»: блоки', () => {
  it('порядок по умолчанию и уникальные id, допустимые серверу (a-z0-9-, до 40)', () => {
    assert.deepEqual(RECEIVER_BLOCKS.map((b) => b.id), ['power', 'volume', 'inputs', 'modes', 'quick', 'nav', 'sound', 'links'])
    assert.equal(new Set(RECEIVER_BLOCKS.map((b) => b.id)).size, RECEIVER_BLOCKS.length)
    for (const b of RECEIVER_BLOCKS) assert.match(b.id, /^[a-z0-9-]{1,40}$/)
  })
  it('ключ порядка — receiver (на сервере layout.receiver) и проходит проверку имени страницы', () => {
    assert.equal(RECEIVER_LAYOUT_PAGE, 'receiver')
    assert.match(RECEIVER_LAYOUT_PAGE, /^[a-z0-9-]{1,30}$/)
  })
  it('страница использует тот же SortableBlocks с этим ключом и теми же id блоков', () => {
    const src = readFileSync(here('../features/receiver/index.tsx'), 'utf8')
    assert.match(src, /SortableBlocks/)
    assert.match(src, /layoutPage=\{RECEIVER_LAYOUT_PAGE\}/)
    for (const b of RECEIVER_BLOCKS) assert.ok(src.includes(`id: '${b.id}'`), b.id)
  })
})

describe('главное меню: пункт «Ресивер»', () => {
  const all = sidebarData.navGroups.flatMap((g) => g.items.map((i) => ({ group: g.title, i })))
  it('есть пункт с адресом /receiver и подзаголовком Marantz NR1604', () => {
    const r = all.find((x) => x.i.url === '/receiver')
    assert.ok(r)
    assert.equal(r.i.title, 'Ресивер')
    assert.equal(r.i.subtitle, 'Marantz NR1604')
    assert.ok(r.i.icon)
  })
  it('стоит рядом с «Медиа» (сразу после него) в той же группе', () => {
    const items = sidebarData.navGroups.find((g) => g.items.some((i) => i.url === '/media'))!.items
    const media = items.findIndex((i) => i.url === '/media')
    assert.equal(items[media + 1].url, '/receiver')
  })
  it('адреса пунктов уникальны (меню не ломается дублем)', () => {
    const urls = all.map((x) => x.i.url)
    assert.equal(new Set(urls).size, urls.length)
  })
})

describe('редирект /media/remote → /receiver', () => {
  it('маршрут /media/remote перенаправляет на /receiver, маршрут /receiver существует', () => {
    const old = readFileSync(here('../routes/_authenticated/media/remote.tsx'), 'utf8')
    assert.match(old, /redirect\(\{ to: '\/receiver'/)
    const tree = readFileSync(here('../routeTree.gen.ts'), 'utf8')
    assert.match(tree, /'\/_authenticated\/receiver\/'/)
  })
  it('внутренних ссылок на /media/remote не осталось', () => {
    for (const f of ['../features/media/index.tsx', '../features/receiver/index.tsx', '../lib/palette.ts']) assert.doesNotMatch(readFileSync(here(f), 'utf8'), /media\/remote/)
  })
})
