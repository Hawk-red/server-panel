import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FOCUS_APPLY_CLASSES, FOCUS_APPLY_MS, focusApply } from './focus-apply.js'

const fakeEl = () => {
  const cls = new Set<string>()
  let scrolled = 0
  return {
    cls,
    get scrolled() { return scrolled },
    scrollIntoView: () => { scrolled++ },
    classList: { add: (...c: string[]) => c.forEach((x) => cls.add(x)), remove: (...c: string[]) => c.forEach((x) => cls.delete(x)) },
  }
}

describe('focusApply', () => {
  it('focus=apply: прокручивает, подсвечивает и снимает подсветку через паузу', () => {
    const el = fakeEl()
    let timer: { fn: () => void; ms: number } | null = null
    assert.equal(focusApply('apply', el, (fn, ms) => (timer = { fn, ms })), true)
    assert.equal(el.scrolled, 1)
    for (const c of FOCUS_APPLY_CLASSES) assert.ok(el.cls.has(c))
    assert.equal(timer!.ms, FOCUS_APPLY_MS)
    timer!.fn()
    assert.equal(el.cls.size, 0)
  })
  it('без параметра или с другим значением ничего не происходит', () => {
    for (const f of [undefined, '', 'other']) {
      const el = fakeEl()
      assert.equal(focusApply(f, el, () => assert.fail('таймер не нужен')), false)
      assert.equal(el.scrolled, 0)
      assert.equal(el.cls.size, 0)
    }
  })
  it('нет блока (обновлений нет) — страница обычная', () => {
    assert.equal(focusApply('apply', null), false)
  })
})
