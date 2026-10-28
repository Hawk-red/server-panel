/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Рендер регулятора громкости на мок-данных (без браузера): три вида («Крутилка», «Пульт», «Капсула»),
// переключатель, шкала обычными числами с тапом по значению для Mute, достижимость потолка,
// отсутствие CSS-переходов у положения и неактивное состояние.
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
      skin={over.skin ?? 'knob'}
      onSkin={'onSkin' in over ? over.onSkin : noop}
      onSend={noop}
      onMute={noop}
      compact={over.compact}
    />,
  )
}
const count = (h: string, re: RegExp) => (h.match(re) ?? []).length

describe('регулятор громкости: рендер', () => {
  it('«Крутилка»: диск, дуга делений в три цвета, стрелка по значению и 4 подписи числами', () => {
    const h = html({ skin: 'knob' })
    assert.match(h, /data-skin="knob"/)
    assert.equal(count(h, /data-mark="/g), 29)
    const on = count(h, /data-mark="on"/g)
    assert.ok(on > 20 && on < 29, `горящих делений ${on} при 52 из 60`)
    for (const c of ['#22c55e', '#facc15', '#ef4444']) assert.ok(h.includes(c), c) // зелёный → жёлтый → красный
    assert.match(h, /data-needle/)
    assert.match(h, /rotate\(99(\.\d+)?deg\)/) // 52 из 60 → 99° на дуге −135…135
    assert.deepEqual([0, 20, 40, 60].map((v) => h.includes(`data-tick="${v}"`)), [true, true, true, true])
    assert.ok(!h.includes('data-tick="10"'), 'подписано не каждое деление')
  })
  it('«Пульт»: панель со штриховкой, прорезь с заливкой, колпачок с насечкой, лампочка и шкала', () => {
    const h = html({ skin: 'mixer' })
    assert.match(h, /data-skin="mixer"/)
    assert.ok(h.includes('repeating-linear-gradient(90deg'), 'вертикальная штриховка панели')
    assert.match(h, /data-fill[^>]*height:86\.6\d*%/) // 52 из 60
    assert.match(h, /data-handle/)
    assert.match(h, /data-led="off"/) // палец не держит фейдер
    for (const v of [0, 10, 20, 30, 40, 50, 60]) assert.ok(h.includes(`data-tick="${v}"`), String(v))
  })
  it('«Капсула»: одна заливка, значок динамика и кнопки ±5 под палец', () => {
    const h = html({ skin: 'capsule' })
    assert.match(h, /data-skin="capsule"/)
    assert.equal(count(h, /data-fill/g), 1)
    assert.match(h, /data-fill[^>]*height:86\.6\d*%/)
    assert.match(h, /<svg/) // значок динамика
    assert.match(h, /data-step="up"[^>]*aria-label="Громче на 5"/)
    assert.match(h, /data-step="down"[^>]*aria-label="Тише на 5"/)
    assert.equal(count(h, /size-10 place-items-center rounded-full/g), 2) // 40 px — размер под палец
    assert.ok(!h.includes('data-handle') && !h.includes('data-tick'))
  })
  it('у положения регулятора нет CSS-переходов (иначе картинка отстаёт от пальца)', () => {
    for (const skin of VOLUME_SKINS) {
      const h = html({ skin })
      for (const bad of [/transition-\[height/, /transition-\[bottom/, /transition-\[transform/, /transition:\s*(all|transform|height|bottom)/]) assert.ok(!bad.test(h), `${skin}: ${String(bad)}`)
    }
  })
  it('переключатель вида: три чипа, нажат текущий; без onSkin чипов нет', () => {
    const h = html({ skin: 'capsule' })
    for (const s of VOLUME_SKINS) assert.ok(h.includes(`data-chip="${s}"`), s)
    for (const t of ['Крутилка', 'Пульт', 'Капсула']) assert.ok(h.includes(t), t)
    assert.match(h, /data-chip="capsule" aria-pressed="true"/)
    assert.match(h, /data-chip="knob" aria-pressed="false"/)
    assert.equal(count(html({ onSkin: undefined }), /data-chip=/g), 0)
  })
  it('значение обычным числом, потолок и тап по значению для Mute', () => {
    const h = html()
    assert.ok(h.includes('>52<')) // volume 52 — без дБ
    assert.ok(!h.includes('dB'), 'дБ в регуляторе не показываем')
    assert.ok(h.includes('потолок') && h.includes('>60<'))
    assert.match(h, /data-mute[^>]*aria-pressed="false"/)
    assert.ok(h.includes('тап — Mute'))
  })
  it('Mute включён: значение красное и подпись «Звук выключен»', () => {
    const h = html({ st: VOLUME_MUTED })
    assert.match(h, /data-mute[^>]*aria-pressed="true"/)
    assert.ok(h.includes('Звук выключен'))
    assert.ok(h.includes('text-destructive'))
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
  it('ресивер выключен: регулятор серый и неактивный, с причиной; кнопки шага заблокированы', () => {
    const h = html({ st: VOLUME_OFF })
    assert.match(h, /data-state="off"/)
    assert.match(h, /aria-disabled="true"/)
    assert.match(h, /tabindex="-1"/)
    assert.ok(h.includes('pointer-events-none') && h.includes('grayscale'))
    assert.ok(h.includes('Ресивер выключен — громкость недоступна'))
    assert.ok(h.includes('>—<')) // значения нет
    assert.equal(count(html({ st: VOLUME_OFF, skin: 'knob' }), /data-mark="on"/g), 0) // дуга не горит
    assert.equal(count(html({ st: VOLUME_OFF, skin: 'capsule' }), /data-step="\w+" aria-label="[^"]*" disabled=""/g), 2)
  })
  it('карточка облегает регулятор: высоту задаёт сам вид, пустых полей нет', () => {
    assert.ok(!html().includes('min-height'), 'фиксированной высоты области больше нет')
    assert.ok(html({ skin: 'knob' }).includes('max-w-[12.5rem]') && html({ skin: 'knob', compact: true }).includes('max-w-[9.5rem]'))
    assert.ok(html({ skin: 'mixer' }).includes('h-52') && html({ skin: 'mixer', compact: true }).includes('h-40'))
    assert.ok(html({ skin: 'capsule' }).includes('h-52') && html({ skin: 'capsule', compact: true }).includes('h-40'))
  })
  it('у потолка диапазон пройден до конца во всех видах', () => {
    assert.equal(levelOf(60, 60), 1)
    const top = { ...VOLUME_ON, volume: 60 }
    const knob = html({ st: top, skin: 'knob' })
    assert.equal(count(knob, /data-mark="on"/g), 29) // горит вся дуга
    assert.match(knob, /rotate\(135(\.\d+)?deg\)/) // стрелка в конце дуги
    assert.match(html({ st: top, skin: 'mixer' }), /data-fill[^>]*height:100%/)
    assert.match(html({ st: top, skin: 'capsule' }), /data-fill[^>]*height:100%/)
    // почти у потолка — дуга уже почти вся
    assert.ok(count(html({ st: VOLUME_HIGH, skin: 'knob' }), /data-mark="on"/g) >= 28)
  })
})
