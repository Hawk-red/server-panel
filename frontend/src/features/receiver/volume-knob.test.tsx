/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Рендер регулятора громкости на мок-данных (без браузера): три скина и переключатель, метка потолка,
// значение в дБ с тапом по нему для Mute, неактивное состояние и упрощённая подсветка.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ceilingOf, VOLUME_SKINS, type VolumeSkin } from '@/lib/volume-drag'
import { VolumeKnob } from './volume-control/volume-knob.tsx'
import { VOLUME_MUTED, VOLUME_OFF, VOLUME_ON } from './volume-control/volume-mock.ts'

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
  it('скин «Фейдер»: световая шкала сегментами, колпачок и метка потолка', () => {
    const h = html({ skin: 'fader' })
    assert.match(h, /data-skin="fader"/)
    assert.equal((h.match(/data-seg="/g) ?? []).length, 18)
    assert.ok((h.match(/data-seg="on"/g) ?? []).length > 0)
    assert.match(h, /data-handle/)
    assert.match(h, /data-ceiling/)
    assert.ok(h.includes('#ef4444')) // красные сегменты у потолка
  })
  it('скин «Циферблат»: стрелка, подписи в дБ и блик стекла', () => {
    const h = html({ skin: 'dial' })
    assert.match(h, /data-skin="dial"/)
    assert.match(h, /<svg/)
    assert.match(h, /rotate\(/) // стрелка повёрнута
    assert.ok(h.includes('url(#vk-glass)') && h.includes('url(#vk-face)'))
    for (const label of ['-80', '-63', '-46', '-29', '-12']) assert.ok(h.includes(`>${label}</text>`), label)
  })
  it('скин «LED»: столбики эквалайзера', () => {
    const h = html({ skin: 'led' })
    assert.match(h, /data-skin="led"/)
    assert.equal((h.match(/data-bar/g) ?? []).length, 11)
    assert.match(h, /data-ceiling/)
  })
  it('переключатель скина: три чипа, нажат текущий; без onSkin чипов нет', () => {
    const h = html({ skin: 'led' })
    for (const s of VOLUME_SKINS) assert.ok(h.includes(`data-chip="${s}"`), s)
    for (const t of ['Фейдер', 'Циферблат', 'LED']) assert.ok(h.includes(t), t)
    assert.match(h, /data-chip="led" aria-pressed="true"/)
    assert.match(h, /data-chip="fader" aria-pressed="false"/)
    assert.equal((html({ onSkin: undefined }).match(/data-chip=/g) ?? []).length, 0)
  })
  it('значение в дБ, потолок и тап по значению для Mute', () => {
    const h = html()
    assert.ok(h.includes('−28,0 dB')) // volume 52
    assert.ok(h.includes('потолок')) // метка потолка подписана
    assert.ok(h.includes('−20,0 dB')) // потолок 60
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
    assert.match(h, /aria-valuetext="−28,0 dB"/)
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
    assert.ok(h.includes('— dB')) // значения нет
    assert.equal((h.match(/data-seg="on"/g) ?? []).length, 0) // шкала не светится
  })
  it('компактный вид ниже полноразмерного, но с теми же частями', () => {
    const full = html()
    const small = html({ compact: true })
    assert.ok(full.includes('min-height:17rem'))
    assert.ok(small.includes('min-height:11rem'))
    for (const h of [full, small]) assert.match(h, /data-volume-knob/)
  })
  it('метка потолка стоит ниже верха шкалы (шкала не кончается потолком)', () => {
    assert.ok(ceilingOf(60) > 0.8 && ceilingOf(60) < 1)
    const h = html({ st: VOLUME_ON })
    const bottom = /data-ceiling[^>]*bottom:([\d.]+)%/.exec(h)?.[1]
    assert.ok(bottom && Number(bottom) > 80 && Number(bottom) < 100, bottom)
  })
})
