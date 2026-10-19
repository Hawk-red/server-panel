import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { activeInput, activeMode, bumpVolume, createHold, formatDb, HOLD_INTERVAL_MS, inputIcon, levelFraction, type ReceiverFullState } from './receiver-remote.ts'

const base: ReceiverFullState = { power: 'ON', volume: 40, volumeDb: -40, maxVolume: 60, mute: false, input: { code: 'BD', name: 'ANDROID' }, inputs: [], mode: 'STEREO', dynEq: 'ON', dynVol: 'MED', refLev: '0', tone: 'OFF', multEq: 'AUDYSSEY' }
const inputs = [
  { code: 'BD', name: 'Blu-ray' },
  { code: 'MPLAY', name: 'ANDROID' },
  { code: 'TV', name: 'PS4 & TV' },
]

describe('receiver-remote', () => {
  it('formatDb', () => {
    assert.equal(formatDb(40), '−40,0 dB')
    assert.equal(formatDb(45.5), '−34,5 dB')
    assert.equal(formatDb(80), '0,0 dB')
    assert.equal(formatDb(null), '— dB')
  })
  it('levelFraction в пределах 0..1', () => {
    assert.equal(levelFraction(40), 0.5)
    assert.equal(levelFraction(95), 1)
    assert.equal(levelFraction(null), 0)
  })
  it('inputIcon', () => {
    assert.equal(inputIcon('PS4 & TV'), '🎮')
    assert.equal(inputIcon('TV AUDIO'), '📺')
    assert.equal(inputIcon('Apple TV'), '🍎')
    assert.equal(inputIcon('GAME'), '🎮')
    assert.equal(inputIcon('Blu-ray'), '💿')
    assert.equal(inputIcon('ANDROID'), '📱')
    assert.equal(inputIcon('MacMini'), '💻')
    assert.equal(inputIcon('Whatever'), '🔌')
  })
  it('activeInput: имя от ресивера важнее кода (SIBD ↔ «ANDROID»)', () => {
    assert.equal(activeInput(base, inputs), 'MPLAY')
    assert.equal(activeInput({ ...base, input: { code: 'TV', name: null } }, inputs), 'TV')
    assert.equal(activeInput(undefined, inputs), null)
  })
  it('activeMode: точное совпадение, иначе последний нажатый пока режим не сменился', () => {
    assert.equal(activeMode('STEREO', null), 'MSSTEREO')
    assert.equal(activeMode('DOLBY DIGITAL', { cmd: 'MSMOVIE', modeAtClick: 'DOLBY DIGITAL' }), 'MSMOVIE')
    assert.equal(activeMode('DTS SURROUND', { cmd: 'MSMOVIE', modeAtClick: 'DOLBY DIGITAL' }), null)
  })
  it('bumpVolume: шаг 0,5, потолок и ноль', () => {
    assert.equal(bumpVolume(base, 'MVUP').volume, 40.5)
    assert.equal(bumpVolume({ ...base, volume: 60 }, 'MVUP').volume, 60)
    assert.equal(bumpVolume({ ...base, volume: 0 }, 'MVDOWN').volume, 0)
  })
  it('удержание: первая команда сразу, затем повтор, не более 4 команд в любой секунде, stop отменяет', () => {
    const times: number[] = []
    let now = 0
    let cb: (() => void) | null = null
    let cleared = false
    const hold = createHold(() => times.push(now), {
      set: (fn) => ((cb = fn), 1),
      clear: () => (cleared = true),
    })
    hold.start()
    hold.start() // повторный start не дублирует
    for (let t = HOLD_INTERVAL_MS; t <= 5000; t += HOLD_INTERVAL_MS) {
      now = t
      cb!()
    }
    assert.equal(times[0], 0)
    for (const t0 of times) assert.ok(times.filter((t) => t >= t0 && t < t0 + 1000).length <= 4)
    hold.stop()
    assert.ok(cleared)
    assert.equal(hold.active, false)
  })
})
