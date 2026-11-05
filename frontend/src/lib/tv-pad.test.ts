import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isTvRepeatable, powerVia, tvKeyStatus, tvPairLabel, tvStatusLabel, TV_ACCESS_HINT } from './tv-pad.ts'

const on = { online: true, paired: true }
describe('телевизор: правила кнопок', () => {
  it('кнопка без ключа серая с подсказкой', () => {
    assert.deepEqual(tvKeyStatus(null, on), { enabled: false, reason: 'команда не назначена' })
  })
  it('кнопка с ключом активна всегда — как у ИК-пульта, статус ТВ (online, paired, список ключей, HA) ни при чём', () => {
    const off = { online: false, paired: true }
    const notPaired = { online: true, paired: false }
    const ha = { online: true, paired: true, driver: 'ha' as const, keys: ['KEY_VOLUP', 'KEY_MUTE', 'KEY_POWER'] }
    const haOffline = { online: false, paired: false, driver: 'ha' as const }
    const direct = { online: true, paired: true, driver: 'direct' as const, keys: ['KEY_MUTE'] }
    for (const k of ['KEY_VOLUP', 'KEY_MUTE', 'KEY_SOURCE', 'KEY_UP', 'KEY_1', 'KEY_POWER']) {
      assert.equal(tvKeyStatus(k, on).enabled, true, k)
      assert.equal(tvKeyStatus(k, off).enabled, true, k)
      assert.equal(tvKeyStatus(k, notPaired).enabled, true, k)
      assert.equal(tvKeyStatus(k, undefined).enabled, true, k)
      assert.equal(tvKeyStatus(k, ha).enabled, true, k)
      assert.equal(tvKeyStatus(k, haOffline).enabled, true, k)
      assert.equal(tvKeyStatus(k, direct).enabled, true, k)
    }
  })
  it('питание: ТВ отвечает — KEY_POWER, не отвечает или нет данных — сцена (команда уходит независимо)', () => {
    assert.equal(powerVia({ online: true }), 'key')
    assert.equal(powerVia({ online: false }), 'scene')
    assert.equal(powerVia(undefined), 'scene')
  })
  it('удержание только у громкости и стрелок', () => {
    for (const k of ['KEY_VOLUP', 'KEY_VOLDOWN', 'KEY_UP', 'KEY_DOWN', 'KEY_LEFT', 'KEY_RIGHT']) assert.equal(isTvRepeatable(k), true, k)
    for (const k of ['KEY_POWER', 'KEY_CHUP', 'KEY_MUTE', 'KEY_ENTER', null]) assert.equal(isTvRepeatable(k), false, String(k))
  })
  it('подпись связи в режиме Home Assistant: есть сущность — «через Home Assistant», нет — «нет в Home Assistant»', () => {
    const ha = { online: false, paired: false, driver: 'ha' as const }
    assert.equal(tvPairLabel(ha)?.label, 'нет в Home Assistant')
    assert.equal(tvPairLabel({ online: true, paired: true, driver: 'ha' })?.label, 'через Home Assistant')
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
