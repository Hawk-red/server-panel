import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { niceCeil } from './chart-scale.js'

describe('niceCeil', () => {
  it('округляет вверх до 1/2/5 в своей единице', () => {
    assert.equal(niceCeil(1), 1)
    assert.equal(niceCeil(3), 5)
    assert.equal(niceCeil(700 * 1024), 1024 * 1024)
    assert.equal(niceCeil(1.7 * 1024 * 1024), 2 * 1024 * 1024)
    assert.equal(niceCeil(38 * 1024 * 1024), 50 * 1024 * 1024)
    assert.equal(niceCeil(450 * 1024 * 1024), 500 * 1024 * 1024)
  })
  it('никогда не меньше значения; ноль и мусор дают 1 КБ', () => {
    for (const v of [1, 7, 1023, 1025, 5e5, 9.99e6, 3.3e8, 4e9])
      assert.ok(niceCeil(v) >= v, String(v))
    assert.equal(niceCeil(0), 1024)
    assert.equal(niceCeil(NaN), 1024)
  })
})
