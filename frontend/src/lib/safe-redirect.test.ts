import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { safeRedirect } from './safe-redirect.js'

describe('safeRedirect', () => {
  it('пропускает внутренние пути панели с параметрами', () => {
    assert.equal(safeRedirect('/updates?focus=apply'), '/updates?focus=apply')
    assert.equal(safeRedirect('/docker'), '/docker')
  })
  it('внешние и подозрительные адреса заменяет на /', () => {
    for (const bad of ['https://evil.com', 'http://evil.com/updates', '//evil.com', '/\\evil.com', '/\t/evil.com', 'javascript:alert(1)', 'updates', '', undefined, null]) {
      assert.equal(safeRedirect(bad), '/', String(bad))
    }
  })
})
