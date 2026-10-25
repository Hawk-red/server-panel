import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isTvRepeatable, powerVia, tvKeyStatus, tvPairLabel, tvStatusLabel, TV_ACCESS_HINT } from './tv-pad.ts'

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
  it('режим Home Assistant: кнопки без сервиса серые с понятной причиной', () => {
    const ha = { online: true, paired: true, driver: 'ha' as const, keys: ['KEY_VOLUP', 'KEY_MUTE', 'KEY_POWER'] }
    assert.equal(tvKeyStatus('KEY_VOLUP', ha).enabled, true)
    assert.deepEqual(tvKeyStatus('KEY_1', ha), { enabled: false, reason: 'через Home Assistant недоступно' })
    assert.deepEqual(tvKeyStatus('KEY_SOURCE', ha), { enabled: false, reason: 'через Home Assistant недоступно' })
    // выключенный ТВ: питание всё равно активно, его поднимает сцена
    assert.equal(tvKeyStatus('KEY_POWER', { ...ha, online: false, keys: [] }).enabled, true)
    assert.equal(tvKeyStatus('KEY_MUTE', { ...ha, online: false }).enabled, false)
  })
  it('режим Home Assistant: телевизора нет в HA — причина про HA, кнопки «Сопрячь» нет', () => {
    const ha = { online: false, paired: false, driver: 'ha' as const }
    assert.equal(tvKeyStatus('KEY_MUTE', ha).reason, 'ТВ не отвечает')
    assert.equal(tvKeyStatus('KEY_MUTE', { ...ha, online: true }).reason, 'телевизора нет в Home Assistant')
    assert.equal(tvPairLabel(ha)?.label, 'нет в Home Assistant')
    assert.equal(tvPairLabel({ online: true, paired: true, driver: 'ha' })?.label, 'через Home Assistant')
  })
  it('прямой режим: список ключей полный, причина без упоминания HA', () => {
    const d = { online: true, paired: true, driver: 'direct' as const, keys: ['KEY_MUTE'] }
    assert.equal(tvKeyStatus('KEY_MUTE', d).enabled, true)
    assert.equal(tvKeyStatus('KEY_1', d).reason, 'кнопка недоступна')
    assert.equal(tvKeyStatus('KEY_1', { online: true, paired: true, driver: 'direct' }).enabled, true) // без списка — как раньше
  })
  it('удержание только у громкости и стрелок', () => {
    for (const k of ['KEY_VOLUP', 'KEY_VOLDOWN', 'KEY_UP', 'KEY_DOWN', 'KEY_LEFT', 'KEY_RIGHT']) assert.equal(isTvRepeatable(k), true, k)
    for (const k of ['KEY_POWER', 'KEY_CHUP', 'KEY_MUTE', 'KEY_ENTER', null]) assert.equal(isTvRepeatable(k), false, String(k))
  })
  it('«в сети» и «сопряжён» — разные подписи', () => {
    assert.equal(tvStatusLabel(on).label, 'в сети')
    assert.equal(tvPairLabel(on)?.label, 'сопряжён')
    assert.equal(tvPairLabel({ online: true, paired: false })?.label, 'не сопряжён')
    assert.equal(tvPairLabel({ online: false, paired: true }), null) // выключенный ТВ: про сопряжение молчим
    assert.equal(tvPairLabel(undefined), null)
    assert.match(TV_ACCESS_HINT, /Менеджер подключения устройств/)
  })
  it('подпись статуса', () => {
    assert.equal(tvStatusLabel(on).label, 'в сети')
    assert.equal(tvStatusLabel({ online: false, paired: false }).label, 'не отвечает')
    assert.equal(tvStatusLabel(undefined).label, 'проверяю…')
    assert.equal(tvStatusLabel(undefined, true).label, 'нет данных')
  })
})
