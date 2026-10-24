import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { lockHints } from './docker-lock.js'

const LOCK = 'идут закачки или проверка: 3'
const NOTE = 'обновление — только после завершения закачек'

describe('lockHints', () => {
  it('актуален, но закачки идут: ни замка, ни подписи', () => {
    assert.deepEqual(lockHints({ upToDate: true, lock: LOCK, note: NOTE }), { lock: null, note: null })
  })
  it('есть обновление и закачки: показано', () => {
    assert.deepEqual(lockHints({ upToDate: false, lock: LOCK, note: NOTE }), { lock: LOCK, note: NOTE })
  })
  it('есть обновление без закачек: не показано', () => {
    assert.deepEqual(lockHints({ upToDate: false, lock: null, note: NOTE }), { lock: null, note: null })
  })
  it('не проверено или ошибка проверки: не показано', () => {
    assert.deepEqual(lockHints({ upToDate: null, lock: LOCK, note: NOTE }), { lock: null, note: null })
    assert.deepEqual(lockHints({ upToDate: false, error: 'таймаут', lock: LOCK, note: NOTE }), { lock: null, note: null })
  })
})
