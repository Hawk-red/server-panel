// Математика регулятора громкости: относительная протяжка → значение с обрезкой по потолку, чувствительность,
// разметка шкалы, шаг клавиатурой, недоступность и отправка «только последнего значения».
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createLatestSender,
  dragSensitivity,
  dragSpan,
  dragToVolume,
  isVolumeSkin,
  knobDisabled,
  levelOf,
  parseVolumeSkin,
  stepVolume,
  volumeTicks,
  volumeUnits,
  VOLUME_SKINS,
  VOLUME_SKIN_TITLE,
} from './volume-drag'

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('протяжка → значение', () => {
  const max = 60
  const sens = dragSensitivity(max, 400) // весь диапазон за 400 px
  it('палец вверх увеличивает, вниз уменьшает (относительно стартового значения)', () => {
    assert.equal(dragToVolume({ start: 40, dy: -100, max, sensitivity: sens }).value, 55)
    assert.equal(dragToVolume({ start: 40, dy: 100, max, sensitivity: sens }).value, 25)
    assert.equal(dragToVolume({ start: 40, dy: 0, max, sensitivity: sens }).value, 40)
  })
  it('значение округляется до половины шага (медленным движением — тонкая настройка)', () => {
    const slow = dragSensitivity(max, 600)
    assert.equal(dragToVolume({ start: 40, dy: -5, max, sensitivity: slow }).value, 40.5)
    assert.equal(dragToVolume({ start: 40, dy: -2, max, sensitivity: slow }).value, 40)
    assert.equal(dragToVolume({ start: 40, dy: -15, max, sensitivity: slow }).value, 41.5)
  })
  it('выше потолка не поднимается и сообщает об упоре', () => {
    const out = dragToVolume({ start: 55, dy: -400, max, sensitivity: sens })
    assert.equal(out.value, 60)
    assert.equal(out.atTop, true)
    assert.equal(dragToVolume({ start: 55, dy: -10, max, sensitivity: sens }).atTop, false)
  })
  it('ниже нуля не опускается', () => {
    const out = dragToVolume({ start: 5, dy: 400, max, sensitivity: sens })
    assert.equal(out.value, 0)
    assert.equal(out.atBottom, true)
  })
  it('весь путь до потолка проходится за один «экран»: длина протяжки 260…620 px', () => {
    assert.equal(dragSpan(844), 620) // телефон
    assert.equal(dragSpan(300), 260) // очень низкое окно
    assert.equal(dragSpan(600), 450)
    const s = dragSensitivity(60, dragSpan(844))
    assert.equal(dragToVolume({ start: 0, dy: -dragSpan(844), max: 60, sensitivity: s }).value, 60)
    assert.ok(dragToVolume({ start: 0, dy: -dragSpan(844) / 2, max: 60, sensitivity: s }).value === 30)
  })
  it('шаг клавиатурой — те же границы', () => {
    assert.equal(stepVolume(40, 0.5, 60), 40.5)
    assert.equal(stepVolume(59, 3, 60), 60)
    assert.equal(stepVolume(0.5, -3, 60), 0)
  })
})

describe('разметка шкалы', () => {
  it('верх рисунка — потолок: у потолка уровень ровно 1 (весь диапазон достижим)', () => {
    assert.equal(levelOf(0, 60), 0)
    assert.equal(levelOf(30, 60), 0.5)
    assert.equal(levelOf(60, 60), 1)
    assert.equal(levelOf(59.5, 60), 59.5 / 60)
    assert.ok(levelOf(59.5, 60) > 0.99)
  })
  it('уровень обрезается по краям', () => {
    assert.equal(levelOf(99, 60), 1)
    assert.equal(levelOf(-5, 60), 0)
    assert.equal(levelOf(10, 0), 1) // потолок не задан — не делим на ноль
  })
  it('значение шкалы показывается обычным числом, без дБ', () => {
    assert.equal(volumeUnits(52), '52')
    assert.equal(volumeUnits(52.5), '52,5')
    assert.equal(volumeUnits(0), '0')
    assert.equal(volumeUnits(52.4), '52,5') // половины шага
    assert.equal(volumeUnits(null), '—')
  })
  it('подписи шкалы: каждые 10 единиц и сам потолок', () => {
    assert.deepEqual(volumeTicks(60).map((t) => t.value), [0, 10, 20, 30, 40, 50, 60])
    assert.deepEqual(volumeTicks(55).map((t) => t.value), [0, 10, 20, 30, 40, 50, 55])
    const ticks = volumeTicks(60)
    assert.equal(ticks[0].frac, 0)
    assert.equal(ticks[ticks.length - 1].frac, 1) // верхняя подпись — на самом верху
    assert.equal(volumeTicks(60, 20).map((t) => t.value).join(), '0,20,40,60')
  })
})

describe('доступность и скины', () => {
  it('регулятор неактивен без состояния, при выключенном ресивере и без значения громкости', () => {
    assert.equal(knobDisabled(undefined), true)
    assert.equal(knobDisabled({ power: 'STANDBY', volume: 40 }), true)
    assert.equal(knobDisabled({ power: 'ON', volume: null }), true)
    assert.equal(knobDisabled({ power: 'ON', volume: 40 }), false)
  })
  it('три скина с подписями чипов', () => {
    assert.deepEqual([...VOLUME_SKINS], ['fader', 'bar', 'led'])
    assert.deepEqual(VOLUME_SKINS.map((s) => VOLUME_SKIN_TITLE[s]), ['Фейдер', 'Полоса', 'LED'])
    for (const s of VOLUME_SKINS) assert.equal(isVolumeSkin(s), true)
    for (const s of ['neon', '', null, 42, {}, 'dial']) assert.equal(isVolumeSkin(s), false)
  })
  it('прежний «Циферблат» читается как «Полоса», мусор — как «Фейдер»', () => {
    assert.equal(parseVolumeSkin('dial'), 'bar')
    assert.equal(parseVolumeSkin('led'), 'led')
    for (const s of ['neon', '', null, undefined, 42, {}]) assert.equal(parseVolumeSkin(s), 'fader', String(s))
  })
})

describe('отправка: только последнее значение', () => {
  it('пока ответ не пришёл, запросов больше не уходит; отправляется самое свежее значение', async () => {
    const calls: number[] = []
    let done: (() => void) | null = null
    const s = createLatestSender((v) => {
      calls.push(v)
      return new Promise<void>((r) => (done = r))
    })
    s.push(41)
    s.push(42)
    s.push(43)
    assert.deepEqual(calls, [41]) // один запрос в полёте
    assert.equal(s.queued, 43) // очередь не копится — ждёт только последнее
    assert.equal(s.busy, true)
    done!()
    await tick()
    assert.deepEqual(calls, [41, 43])
    assert.equal(s.queued, null)
    done!()
    await tick()
    assert.deepEqual(calls, [41, 43])
    assert.equal(s.busy, false)
  })
  it('признак «финальное» не теряется, если поверх него пришло ещё значение', async () => {
    const seen: [number, boolean][] = []
    let done: (() => void) | null = null
    const s = createLatestSender((v, f) => {
      seen.push([v, f])
      return new Promise<void>((r) => (done = r))
    })
    s.push(41)
    s.push(42, true)
    s.push(43)
    done!()
    await tick()
    assert.deepEqual(seen, [
      [41, false],
      [43, true],
    ])
  })
  it('ошибка не останавливает отправку', async () => {
    const calls: number[] = []
    const s = createLatestSender((v) => {
      calls.push(v)
      return Promise.reject(new Error('нет связи'))
    })
    s.push(41)
    await tick()
    s.push(42)
    await tick()
    assert.deepEqual(calls, [41, 42])
    assert.equal(s.busy, false)
  })
})
