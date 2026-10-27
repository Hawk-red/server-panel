/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Рендер регулятора громкости на мок-данных (без браузера): три скина и переключатель, шкала обычными
// числами с тапом по значению для Mute, достижимость потолка, неактивное состояние и упрощённая подсветка.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { levelOf, VOLUME_SKINS, type VolumeSkin } from '@/lib/volume-drag'
import { VolumeKnob } from './volume-control/volume-knob.tsx'
import { VOLUME_HIGH, VOLUME_MUTED, VOLUME_OFF, VOLUME_ON } from './volume-control/volume-mock.ts'

const noop = () => {}
type St = typeof VOLUME_ON
const html = (over: { st?: St; skin?: VolumeSkin; onSkin?: ((s: VolumeSkin) => void) | undefined; compact?: boolean } = {}) => {
  const st = over.st ?? VOLUME_ON
  const disabled = st.power !== 'ON' || st.volume === null
  return renderToStaticMarkup(
    <VolumeKnob
      value={st.volume}
      max={st.maxVolume}
      mute={st.mute === true}
      disabled={disabled}
      reason={disabled ? 'Ресивер выключен — громкость недоступна' : null}
      skin={over.skin ?? 'fader'}
      onSkin={'onSkin' in over ? over.onSkin : noop}
      onSend={noop}
      onMute={noop}
      compact={over.compact}
    />,
  )
}

describe('регулятор громкости: рендер', () => {
  it('скин «Фейдер»: прорезь с заливкой, бегунок и шкала обычными числами', () => {
    const h = html({ skin: 'fader' })
    assert.match(h, /data-skin="fader"/)
    assert.match(h, /data-fill[^>]*height:86\.6\d*%/) // 52 из 60
    assert.match(h, /data-handle/)
    for (const v of [0, 10, 20, 30, 40, 50, 60]) assert.ok(h.includes(`data-tick="${v}"`), String(v))
    assert.ok(!h.includes('data-seg'), 'лишней световой шкалы у фейдера больше нет')
    assert.ok(!h.includes('repeating-linear-gradient'), 'декоративных текстур больше нет')
  })
  it('скин «Полоса»: только заливка снизу вверх, без лишних элементов', () => {
    const h = html({ skin: 'bar' })
    assert.match(h, /data-skin="bar"/)
    assert.equal((h.match(/data-fill/g) ?? []).length, 1)
    assert.match(h, /data-fill[^>]*height:86\.6\d*%/)
    assert.ok(!h.includes('<svg') && !h.includes('data-seg') && !h.includes('data-tick') && !h.includes('data-handle'))
    assert.ok(!h.includes('data-glow'), 'даже подсветки нет — самый дешёвый вид')
  })
  it('скин «LED»: одинаковые столбики из сегментов', () => {
    const h = html({ skin: 'led' })
    assert.match(h, /data-skin="led"/)
    assert.equal((h.match(/data-bar/g) ?? []).length, 7)
    assert.equal((h.match(/data-seg="/g) ?? []).length, 7 * 12)
    assert.equal((h.match(/data-seg="on"/g) ?? []).length, 7 * 10) // 52 из 60 → 10 сегментов из 12
  })
  it('положение заливки и бегунка — без CSS-переходов (иначе палец «опережает» картинку)', () => {
    for (const skin of VOLUME_SKINS) {
      const h = html({ skin })
      for (const bad of [/transition-\[height/, /transition-\[bottom/, /transition:\s*(all|transform|height)/]) assert.ok(!bad.test(h), `${skin}: ${String(bad)}`)
    }
  })
  it('переключатель скина: три чипа, нажат текущий; без onSkin чипов нет', () => {
    const h = html({ skin: 'led' })
    for (const s of VOLUME_SKINS) assert.ok(h.includes(`data-chip="${s}"`), s)
    for (const t of ['Фейдер', 'Полоса', 'LED']) assert.ok(h.includes(t), t)
    assert.match(h, /data-chip="led" aria-pressed="true"/)
    assert.match(h, /data-chip="fader" aria-pressed="false"/)
    assert.equal((html({ onSkin: undefined }).match(/data-chip=/g) ?? []).length, 0)
  })
  it('значение обычным числом, потолок и тап по значению для Mute', () => {
    const h = html()
    assert.ok(h.includes('>52<')) // volume 52 — без дБ
    assert.ok(!h.includes('dB'), 'дБ в регуляторе больше не показываем')
    assert.ok(h.includes('потолок'))
    assert.ok(h.includes('>60<')) // потолок 60
    assert.match(h, /data-mute[^>]*aria-pressed="false"/)
    assert.ok(h.includes('тап — Mute'))
  })
  it('Mute включён: значение красное и подпись «Звук выключен»', () => {
    const h = html({ st: VOLUME_MUTED })
    assert.match(h, /data-mute[^>]*aria-pressed="true"/)
    assert.ok(h.includes('Звук выключен'))
    assert.ok(h.includes('text-red-400'))
  })
  it('ползунок доступен клавиатуре: role=slider со значениями', () => {
    const h = html()
    assert.match(h, /role="slider"/)
    assert.match(h, /aria-valuemin="0"/)
    assert.match(h, /aria-valuemax="60"/)
    assert.match(h, /aria-valuenow="52"/)
    assert.match(h, /aria-valuetext="52"/)
    assert.match(h, /tabindex="0"/)
    assert.match(h, /touch-action:none/)
  })
  it('ресивер выключен: регулятор серый и неактивный, с причиной', () => {
    const h = html({ st: VOLUME_OFF })
    assert.match(h, /data-state="off"/)
    assert.match(h, /aria-disabled="true"/)
    assert.match(h, /tabindex="-1"/)
    assert.ok(h.includes('pointer-events-none') && h.includes('grayscale'))
    assert.ok(h.includes('Ресивер выключен — громкость недоступна'))
    assert.ok(h.includes('>—<')) // значения нет
    assert.equal((html({ st: VOLUME_OFF, skin: 'led' }).match(/data-seg="on"/g) ?? []).length, 0) // шкала не светится
  })
  it('компактный вид ниже полноразмерного, но с теми же частями', () => {
    const full = html()
    const small = html({ compact: true })
    assert.ok(full.includes('min-height:17rem'))
    assert.ok(small.includes('min-height:11rem'))
    for (const h of [full, small]) assert.match(h, /data-volume-knob/)
  })
  it('у потолка диапазон пройден до конца: заливка на 100 %, все сегменты LED горят', () => {
    assert.equal(levelOf(60, 60), 1)
    const top = { ...VOLUME_ON, volume: 60 }
    assert.match(html({ st: top, skin: 'fader' }), /data-fill[^>]*height:100%/)
    assert.match(html({ st: top, skin: 'bar' }), /data-fill[^>]*height:100%/)
    assert.equal((html({ st: top, skin: 'led' }).match(/data-seg="on"/g) ?? []).length, 7 * 12)
    // почти у потолка — тоже не ниже последнего сегмента
    assert.equal((html({ st: VOLUME_HIGH, skin: 'led' }).match(/data-seg="on"/g) ?? []).length, 7 * 12)
  })
})
