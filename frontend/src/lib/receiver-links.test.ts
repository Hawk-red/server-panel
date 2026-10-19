import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RECEIVER_LINK_GROUPS } from './receiver-links.ts'

describe('RECEIVER_LINK_GROUPS', () => {
  const all = RECEIVER_LINK_GROUPS.flatMap((g) => g.links)
  it('только фреймсеты f_*.asp внутри /SETUP/', () => {
    for (const l of all)
      assert.match(l.path, /^\/SETUP\/[A-Z0-9]+\/[A-Z0-9]+\/f_[A-Za-z_]+\.asp$/)
  })
  it('нет опасных страниц', () => {
    for (const l of all)
      assert.doesNotMatch(
        l.path,
        /firmware|default|restore|standby|setuplock|reset|init|update/i
      )
  })
  it('пути не повторяются', () => {
    assert.equal(new Set(all.map((l) => l.path)).size, all.length)
  })
})
