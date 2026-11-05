import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { commandTitle, filterCommands, isCustom, isRepeatable, keyStatus, liveInputName, needsPower, type RemoteConfig } from './receiver-pad.ts'

const st = { power: 'ON' as const, inputs: [{ code: 'SAT/CBL', name: 'IPAD' }, { code: 'BD', name: 'ANDROID' }, { code: 'TV', name: 'PS4 & TV' }] }
const cfg: RemoteConfig = {
  defaults: { play: null, eco: 'ECOCYCLE', back: 'MNRTN' },
  bindings: { play: null, eco: 'ECOOFF', back: 'MNRTN' },
  commands: [
    { command: 'ECOOFF', title: 'ECO: выключить', group: 'Звук' },
    { command: 'ECOCYCLE', title: 'ECO: по кругу', group: 'Звук' },
    { command: 'MNRTN', title: 'Меню: назад', group: 'Меню' },
    { command: 'SIBD', title: 'Вход: Blu-ray', group: 'Входы' },
  ],
}

describe('пульт: доступность кнопок', () => {
  it('без команды — неактивна с подсказкой «команда не назначена»', () => {
    assert.deepEqual(keyStatus(null, st), { enabled: false, reason: 'команда не назначена' })
  })
  it('кнопка с командой активна всегда — как у ИК-пульта, статус ресивера (питание, связь, живой список входов) ни при чём', () => {
    const off = { ...st, power: 'STANDBY' as const }
    for (const c of ['PWTOGGLE', 'PWON', 'ZMTOGGLE', 'Z2ON', 'Z2TOGGLE', 'MVUP', 'MNCUP', 'SIBD', 'SICD', 'MUTOGGLE', 'ECOCYCLE', 'MSMOVIE']) {
      assert.equal(keyStatus(c, st).enabled, true, c)
      assert.equal(keyStatus(c, off).enabled, true, c)
      assert.equal(keyStatus(c, undefined).enabled, true, c)
    }
  })
  it('needsPower: какие команды работают из режима ожидания (для будущего индикатора, на нажатие не влияет)', () => {
    assert.equal(needsPower('MVUP'), true)
    assert.equal(needsPower('PWON'), false)
  })
  it('живое имя входа под подписью — только для привязки ко входу', () => {
    assert.equal(liveInputName('SISAT/CBL', st), 'IPAD')
    assert.equal(liveInputName('SITV', st), 'PS4 & TV')
    assert.equal(liveInputName('SICD', st), null)
    assert.equal(liveInputName('MVUP', st), null)
    assert.equal(liveInputName(null, st), null)
  })
})

describe('пульт: удержание', () => {
  it('повторяются громкость, стрелки и шаг тюнера; остальное — нет', () => {
    for (const c of ['MVUP', 'MVDOWN', 'MNCUP', 'MNCDN', 'MNCLT', 'MNCRT', 'TFANUP', 'TFANDOWN']) assert.equal(isRepeatable(c), true, c)
    for (const c of ['PWTOGGLE', 'MNENT', 'MNRTN', 'MSMOVIE', 'SIBD', 'ECOCYCLE', 'SLPCYCLE', 'TPANUP', null]) assert.equal(isRepeatable(c), false, String(c))
  })
})

describe('пульт: выбор команды', () => {
  it('поиск по названию, команде и группе без учёта регистра', () => {
    assert.deepEqual(filterCommands(cfg.commands, 'eco').map((c) => c.command), ['ECOOFF', 'ECOCYCLE'])
    assert.deepEqual(filterCommands(cfg.commands, 'НАЗАД').map((c) => c.command), ['MNRTN'])
    assert.deepEqual(filterCommands(cfg.commands, 'входы').map((c) => c.command), ['SIBD'])
    assert.equal(filterCommands(cfg.commands, '  ').length, 4)
    assert.equal(filterCommands(cfg.commands, 'нет такого').length, 0)
  })
  it('подписи привязок и отличие от умолчания', () => {
    assert.equal(commandTitle(cfg, null), 'без команды')
    assert.equal(commandTitle(cfg, 'MNRTN'), 'Меню: назад')
    assert.equal(commandTitle(cfg, 'XYZ'), 'XYZ')
    assert.equal(isCustom(cfg, 'eco'), true)
    assert.equal(isCustom(cfg, 'back'), false)
    assert.equal(isCustom(cfg, 'play'), false)
  })
})
