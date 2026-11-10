import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isUgoosRepeatable, ugoosKeyStatus, ugoosStatusLabel } from './ugoos-pad.ts'

const on = { online: true }
describe('UGOOS: правила кнопок', () => {
  it('кнопка без ключа серая с подсказкой', () => {
    assert.deepEqual(ugoosKeyStatus(null, on), { enabled: false, reason: 'команда не назначена' })
  })
  it('кнопка с ключом активна всегда — статус бокса (online, список ключей) ни при чём', () => {
    const off = { online: false }
    for (const k of ['VOL_UP', 'MUTE', 'HOME', 'DPAD_UP', 'POWER']) {
      assert.equal(ugoosKeyStatus(k, on).enabled, true, k)
      assert.equal(ugoosKeyStatus(k, off).enabled, true, k)
      assert.equal(ugoosKeyStatus(k, undefined).enabled, true, k)
    }
  })
  it('удержание только у громкости и D-pad', () => {
    for (const k of ['VOL_UP', 'VOL_DOWN', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT']) assert.equal(isUgoosRepeatable(k), true, k)
    for (const k of ['POWER', 'MUTE', 'HOME', 'BACK', 'MENU', 'DPAD_CENTER', null]) assert.equal(isUgoosRepeatable(k), false, String(k))
  })
  it('подпись статуса', () => {
    assert.equal(ugoosStatusLabel(on).label, 'в сети')
    assert.equal(ugoosStatusLabel({ online: false }).label, 'не отвечает')
    assert.equal(ugoosStatusLabel(undefined).label, 'проверяю…')
    assert.equal(ugoosStatusLabel(undefined, true).label, 'нет данных')
  })
})
