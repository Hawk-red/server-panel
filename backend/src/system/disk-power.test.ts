import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { STANDBY_IDLE_MS, type PowerInput, derivePowerState, isPowerCheckUnsupported, isStandbyOutput } from './disk-power.js'

const base: PowerInput = { rotational: true, smartStatus: 'ok', powerCheckUnsupported: false, idleMs: 0 }
const st = (o: Partial<PowerInput>) => derivePowerState({ ...base, ...o })
const LONG = STANDBY_IDLE_MS + 1000

describe('derivePowerState', () => {
  it('SSD никогда не «спит», даже если в кэше SMART стоит standby и ввода-вывода нет', () => {
    assert.equal(st({ rotational: false, smartStatus: 'standby', idleMs: LONG }), 'ssd')
    assert.equal(st({ rotational: false }), 'ssd')
  })
  it('HDD: standby от smartctl + долгая тишина → «Спит»', () => {
    assert.equal(st({ smartStatus: 'standby', idleMs: LONG }), 'standby')
  })
  it('HDD: standby в кэше, но ввод-вывод был недавно → «активен» (диск уже проснулся)', () => {
    assert.equal(st({ smartStatus: 'standby', idleMs: 20_000 }), 'active')
  })
  it('HDD: тишина, но smartctl standby не подтвердил → не «Спит»', () => {
    assert.equal(st({ smartStatus: 'ok', idleMs: LONG }), 'active')
  })
  it('USB без ATA CHECK POWER STATUS → «неизвестно», даже при тишине и standby в кэше', () => {
    assert.equal(st({ powerCheckUnsupported: true, smartStatus: 'standby', idleMs: LONG }), 'unknown')
    assert.equal(st({ powerCheckUnsupported: true }), 'unknown')
  })
  it('нет данных (нет истории I/O, SMART не опрошен, rotational не прочитан) → «неизвестно»', () => {
    assert.equal(st({ smartStatus: 'standby', idleMs: null }), 'unknown')
    assert.equal(st({ smartStatus: null, idleMs: LONG }), 'unknown')
    assert.equal(st({ rotational: null }), 'unknown')
  })
})

describe('разбор вывода smartctl', () => {
  it('standby — только по настоящей фразе, а не по любому слову', () => {
    assert.equal(isStandbyOutput('Device is in STANDBY mode, exit(2)'), true)
    assert.equal(isStandbyOutput('{"string":"Device is in SLEEP mode"}'), true)
    assert.equal(isStandbyOutput('{"name":"Suspend_Offline_Collection_Upon_New_Command","note":"standby sleep"}'), false)
  })
  it('распознаёт «no ATA CHECK POWER STATUS support»', () => {
    assert.equal(isPowerCheckUnsupported('Device: /dev/sdc [SAT], no ATA CHECK POWER STATUS support, ignoring -n Directive'), true)
    assert.equal(isPowerCheckUnsupported('SMART overall-health self-assessment test result: PASSED'), false)
  })
})
