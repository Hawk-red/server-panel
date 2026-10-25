/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Рендер пульта ТВ на мок-данных: раскладка, подписи, серые кнопки, режим настройки.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { CommandPicker } from '@/features/receiver/remote-tab'
import { TvPad } from './tv-pad'
import { TV_CFG, TV_OFFLINE, TV_ONLINE } from './tv-mock'

const noop = () => {}
const html = (over: { st?: typeof TV_ONLINE | undefined; configure?: boolean; cfg?: typeof TV_CFG | undefined } = {}) =>
  renderToStaticMarkup(<TvPad st={'st' in over ? over.st : TV_ONLINE} cfg={'cfg' in over ? over.cfg : TV_CFG} configure={over.configure ?? false} onPress={noop} onPick={noop} />)
const state = (h: string, id: string) => new RegExp(`data-key="${id}"[^>]*data-state="(\\w+)"`).exec(h)?.[1]

describe('пульт Samsung AA59-00602A: рендер', () => {
  it('44 кнопки, подписи оригинала и модель внизу', () => {
    const h = html()
    assert.equal((h.match(/data-key="/g) ?? []).length, 44)
    for (const t of ['SOURCE', 'TTX/MIX', 'PRE-CH', 'CH LIST', 'CONTENT', 'MENU', 'GUIDE', 'TOOLS', 'INFO', 'RETURN', 'EXIT', 'E-MANUAL', 'P.SIZE', 'AD/SUBT.', 'AA59-00602A', 'Vol']) assert.ok(h.includes(t), t)
    for (const l of ['aria-label="A"', 'aria-label="B"', 'aria-label="C"', 'aria-label="D"', 'aria-label="STOP"', 'aria-label="POWER"']) assert.ok(h.includes(l), l)
  })
  it('цветные кнопки красная, зелёная, жёлтая, синяя; POWER красная', () => {
    const h = html()
    assert.match(h, /data-key="color-a"[^>]*bg-red-600/)
    assert.match(h, /data-key="color-b"[^>]*bg-green-600/)
    assert.match(h, /data-key="color-c"[^>]*bg-yellow-400/)
    assert.match(h, /data-key="color-d"[^>]*bg-blue-600/)
    assert.match(h, /data-key="power"[^>]*from-red-500/)
  })
  it('ключи из привязок видны в data-command', () => {
    const h = html()
    assert.match(h, /data-key="color-d" data-command="KEY_CYAN"/)
    assert.match(h, /data-key="vol-up" data-command="KEY_VOLUP"/)
    assert.match(h, /data-key="enter" data-command="KEY_ENTER"/)
  })
  it('ТВ в сети и сопряжён — все кнопки активны', () => {
    assert.equal((html().match(/data-state="on"/g) ?? []).length, 44)
  })
  it('ТВ не отвечает: серые все, кроме питания', () => {
    const h = html({ st: TV_OFFLINE })
    assert.equal(state(h, 'power'), 'on')
    assert.equal((h.match(/data-state="on"/g) ?? []).length, 1)
    assert.match(h, /VOL \+ — ТВ не отвечает/)
  })
  it('кнопка без ключа серая с подсказкой «команда не назначена»', () => {
    const cfg = { ...TV_CFG, bindings: { ...TV_CFG.bindings, ad: null } }
    const h = html({ cfg })
    assert.equal(state(h, 'ad'), 'off')
    assert.match(h, /AD\/SUBT\. — команда не назначена/)
  })
  it('нет данных и нет привязок — всё серое, без падения', () => {
    assert.equal((html({ st: undefined }).match(/data-state="on"/g) ?? []).length, 0)
    assert.equal((html({ cfg: undefined }).match(/data-state="on"/g) ?? []).length, 0)
  })
  it('режим настройки: все 44 кнопки выбираются, изменённая помечена', () => {
    const cfg = { ...TV_CFG, bindings: { ...TV_CFG.bindings, ad: 'KEY_MENU' } }
    const h = html({ configure: true, cfg, st: TV_OFFLINE })
    assert.equal((h.match(/data-state="configure"/g) ?? []).length, 44)
    assert.equal((h.match(/bg-amber-400/g) ?? []).length, 1)
    assert.match(h, /AD\/SUBT\.: Меню/)
  })
  it('окно выбора ключа закрыто, пока кнопка не выбрана', () => {
    assert.equal(renderToStaticMarkup(<CommandPicker button={null} cfg={TV_CFG} onClose={noop} onChoose={noop} />), '')
  })
})
