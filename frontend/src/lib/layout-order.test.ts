import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyOrder, moveItem } from './layout-order.ts'

const blocks = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => ({ id }))
const ids = (l: { id: string }[]) => l.map((b) => b.id)

describe('порядок блоков: applyOrder', () => {
  it('без сохранённого порядка — порядок по умолчанию', () => {
    assert.deepEqual(ids(applyOrder(blocks, [])), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  })
  it('сохранённый порядок применяется (загрузка)', () => {
    assert.deepEqual(ids(applyOrder(blocks, ['h', 'a'])).slice(0, 3), ['h', 'a', 'b'])
  })
  it('неизвестные ключи игнорируются', () => {
    const r = ids(applyOrder(blocks, ['ghost', 'f', 'removed-block', 'a']))
    assert.deepEqual(r.slice(0, 2), ['f', 'a'])
    assert.equal(r.length, blocks.length)
    assert.ok(!r.includes('ghost'))
  })
  it('новый блок, которого нет в сохранённом порядке, встаёт в конец', () => {
    const saved = ['h', 'f', 'a'] // «будущий» блок ещё не сохранён
    const future = [...blocks, { id: 'new-block' }]
    const r = ids(applyOrder(future, saved))
    assert.equal(r.at(-1), 'new-block')
    assert.deepEqual(r.slice(0, 3), ['h', 'f', 'a'])
  })
  it('сброс (пустой список) возвращает порядок по умолчанию', () => {
    assert.deepEqual(ids(applyOrder(blocks, ['h', 'f'])).slice(0, 2), ['h', 'f'])
    assert.deepEqual(ids(applyOrder(blocks, [])), ids(blocks))
  })
  it('не меняет исходный список', () => {
    const before = ids(blocks)
    applyOrder(blocks, ['h'])
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
    assert.equal(ids(applyOrder(blocks, moved))[0], 'h')
  })
})
