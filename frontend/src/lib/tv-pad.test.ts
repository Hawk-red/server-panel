import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isTvRepeatable, powerVia, tvKeyStatus, tvStatusLabel } from './tv-pad.ts'

const on = { online: true, paired: true }
describe('телевизор: правила кнопок', () => {
  it('кнопка без ключа серая с подсказкой', () => {
    assert.deepEqual(tvKeyStatus(null, on), { enabled: false, reason: 'команда не назначена' })
  })
  it('ТВ не отвечает: всё серое, кроме питания (оно идёт сценой)', () => {
    const off = { online: false, paired: true }
    for (const k of ['KEY_VOLUP', 'KEY_MUTE', 'KEY_SOURCE', 'KEY_UP', 'KEY_1']) assert.deepEqual(tvKeyStatus(k, off), { enabled: false, reason: 'ТВ не отвечает' }, k)
    assert.equal(tvKeyStatus('KEY_POWER', off).enabled, true)
  })
  it('в сети, но не сопряжён: серые с причиной; питание активно', () => {
    assert.equal(tvKeyStatus('KEY_MUTE', { online: true, paired: false }).reason, 'ТВ не сопряжён')
    assert.equal(tvKeyStatus('KEY_POWER', { online: true, paired: false }).enabled, true)
  })
  it('в сети и сопряжён: активны; нет данных — серые', () => {
    assert.equal(tvKeyStatus('KEY_MUTE', on).enabled, true)
    assert.equal(tvKeyStatus('KEY_MUTE', undefined).enabled, false)
  })
  it('питание: ТВ отвечает — KEY_POWER, не отвечает или нет данных — сцена', () => {
    assert.equal(powerVia({ online: true }), 'key')
    assert.equal(powerVia({ online: false }), 'scene')
    assert.equal(powerVia(undefined), 'scene')
  })
  it('удержание только у громкости и стрелок', () => {
    for (const k of ['KEY_VOLUP', 'KEY_VOLDOWN', 'KEY_UP', 'KEY_DOWN', 'KEY_LEFT', 'KEY_RIGHT']) assert.equal(isTvRepeatable(k), true, k)
    for (const k of ['KEY_POWER', 'KEY_CHUP', 'KEY_MUTE', 'KEY_ENTER', null]) assert.equal(isTvRepeatable(k), false, String(k))
  })
  it('подпись статуса', () => {
    assert.equal(tvStatusLabel(on).label, 'в сети')
    assert.equal(tvStatusLabel({ online: false, paired: false }).label, 'не отвечает')
    assert.equal(tvStatusLabel(undefined).label, 'проверяю…')
    assert.equal(tvStatusLabel(undefined, true).label, 'нет данных')
  })
})
