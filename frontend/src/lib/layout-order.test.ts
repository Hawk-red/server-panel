import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyOrder, moveItem } from './layout-order.ts'
import { RECEIVER_BLOCKS } from './receiver-layout.ts'

const blocks = RECEIVER_BLOCKS.map((b) => ({ id: b.id }))
const ids = (l: { id: string }[]) => l.map((b) => b.id)

describe('порядок блоков: applyOrder', () => {
  it('без сохранённого порядка — порядок по умолчанию', () => {
    assert.deepEqual(ids(applyOrder(blocks, [])), ['power', 'volume', 'inputs', 'modes', 'quick', 'nav', 'sound', 'links'])
  })
  it('сохранённый порядок применяется (загрузка)', () => {
    assert.deepEqual(ids(applyOrder(blocks, ['links', 'power'])).slice(0, 3), ['links', 'power', 'volume'])
  })
  it('неизвестные ключи игнорируются', () => {
    const r = ids(applyOrder(blocks, ['ghost', 'nav', 'removed-block', 'power']))
    assert.deepEqual(r.slice(0, 2), ['nav', 'power'])
    assert.equal(r.length, blocks.length)
    assert.ok(!r.includes('ghost'))
  })
  it('новый блок, которого нет в сохранённом порядке, встаёт в конец', () => {
    const saved = ['links', 'nav', 'power'] // «будущий» блок ещё не сохранён
    const future = [...blocks, { id: 'new-block' }]
    const r = ids(applyOrder(future, saved))
    assert.equal(r.at(-1), 'new-block')
    assert.deepEqual(r.slice(0, 3), ['links', 'nav', 'power'])
  })
  it('сброс (пустой список) возвращает порядок по умолчанию', () => {
    assert.deepEqual(ids(applyOrder(blocks, ['links', 'nav'])).slice(0, 2), ['links', 'nav'])
    assert.deepEqual(ids(applyOrder(blocks, [])), ids(blocks))
  })
  it('не меняет исходный список', () => {
    const before = ids(blocks)
    applyOrder(blocks, ['links'])
    assert.deepEqual(ids(blocks), before)
  })
})

describe('порядок блоков: moveItem (сохранение после перетаскивания)', () => {
  it('переносит блок вперёд и назад', () => {
    assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a'])
    assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b'])
  })
  it('выход за границы и тот же индекс — без изменений', () => {
    const l = ['a', 'b']
    assert.equal(moveItem(l, 0, 0), l)
    assert.equal(moveItem(l, 0, 5), l)
    assert.equal(moveItem(l, -1, 0), l)
  })
  it('сохранённый после переноса порядок восстанавливается через applyOrder', () => {
    const moved = moveItem(ids(blocks), 7, 0)
    assert.equal(ids(applyOrder(blocks, moved))[0], 'links')
  })
})
