// Рендер экранного пульта на мок-данных (без браузера): раскладка, подписи, неактивные кнопки, режим настройки.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { CommandPicker } from './remote-tab.tsx'
import { RemotePad } from './remote-pad.tsx'
import { MOCK_CFG, MOCK_STATE } from './remote-mock.ts'

const noop = () => {}
const html = (over: { st?: typeof MOCK_STATE | undefined; configure?: boolean; cfg?: typeof MOCK_CFG | undefined } = {}) =>
  renderToStaticMarkup(<RemotePad st={'st' in over ? over.st : MOCK_STATE} cfg={'cfg' in over ? over.cfg : MOCK_CFG} configure={over.configure ?? false} onPress={noop} onPick={noop} />)
const state = (h: string, id: string) => new RegExp(`data-key="${id}"[^>]*data-state="(\\w+)"`).exec(h)?.[1]

describe('пульт RC042SR: рендер', () => {
  it('45 кнопок и подписи оригинала, логотип и модель', () => {
    const h = html()
    assert.equal((h.match(/data-key="/g) ?? []).length, 45)
    for (const t of ['MAIN', 'ZONE 2', 'SLEEP', 'CBL/SAT', 'MEDIA PLAYER', 'TV AUDIO', 'INTERNET RADIO', 'Bluetooth', 'PHONO', 'HEOS', 'ENTER', 'BACK', 'SETUP', 'INFO', 'OPTION', 'TUNE −', 'TUNE +', 'MOVIE', 'MUSIC', 'PURE', 'marantz', 'RC042SR', 'Smart select', 'Sound mode', 'Volume', 'Ch/Page']) assert.ok(h.includes(t), t)
  })
  it('под подписью входа — реальное имя из ресивера', () => {
    const h = html()
    assert.ok(h.includes('IPAD')) // CBL/SAT
    assert.ok(h.includes('PS4 &amp; TV')) // TV AUDIO
  })
  it('входов нет в живом списке и кнопки без команды — серые', () => {
    const h = html()
    for (const id of ['in-8k', 'in-usb', 'in-bt', 'in-heos', 'in-phono', 'play']) assert.equal(state(h, id), 'off', id) // команда не назначена
    assert.equal(state(h, 'in-cd'), 'off') // CD нет в живом списке
    for (const id of ['in-cblsat', 'in-bd', 'in-tv', 'vol-up', 'power', 'nav-up', 'ss-1', 'sm-movie']) assert.equal(state(h, id), 'on', id)
    assert.match(h, /PHONO — команда не назначена/)
    assert.match(h, /CD — такого входа нет в списке ресивера/)
  })
  it('ресивер выключен: активны только питание и зоны', () => {
    const h = html({ st: { ...MOCK_STATE, power: 'STANDBY' } })
    for (const id of ['power', 'zone-main', 'zone-2']) assert.equal(state(h, id), 'on', id)
    for (const id of ['vol-up', 'mute', 'nav-up', 'in-bd', 'sm-music']) assert.equal(state(h, id), 'off', id)
  })
  it('нет связи (состояния нет) или привязки не загрузились — всё серое, без падения', () => {
    const a = html({ st: undefined })
    const b = html({ cfg: undefined })
    for (const h of [a, b]) assert.equal((h.match(/data-state="on"/g) ?? []).length, 0)
  })
  it('удержание только у громкости и стрелок: у остальных обычный onClick (в разметке не видно) — команды в data-command', () => {
    const h = html()
    assert.match(h, /data-key="vol-up" data-command="MVUP"/)
    assert.match(h, /data-key="power" data-command="PWTOGGLE"/)
    assert.match(h, /data-key="sm-pure" data-command="MSPURE DIRECT"/)
    assert.match(h, /data-key="ss-4" data-command="MSQUICK4"/)
  })
  it('режим настройки: все кнопки доступны для выбора, изменённые помечены', () => {
    const cfg = { ...MOCK_CFG, bindings: { ...MOCK_CFG.bindings, play: 'MNENT' } }
    const h = html({ configure: true, cfg })
    assert.equal((h.match(/data-state="configure"/g) ?? []).length, 45)
    assert.equal((h.match(/bg-amber-400/g) ?? []).length, 1)
    assert.match(h, /PHONO: без команды/)
  })
  it('активные: текущий вход, режим, mute', () => {
    const h = html({ st: { ...MOCK_STATE, mute: true, mode: 'MOVIE', input: { code: 'BD', name: 'ANDROID' } } })
    assert.match(h, /data-key="in-bd"[^>]*aria-pressed="true"/)
    assert.match(h, /data-key="sm-movie"[^>]*aria-pressed="true"/)
    assert.match(h, /data-key="mute"[^>]*aria-pressed="true"/)
    assert.match(h, /data-key="in-dvd"[^>]*aria-pressed="false"/)
  })
  it('окно выбора команды: пустое, когда кнопка не выбрана', () => {
    assert.equal(renderToStaticMarkup(<CommandPicker button={null} cfg={MOCK_CFG} onClose={noop} onChoose={noop} />), '')
  })
})
