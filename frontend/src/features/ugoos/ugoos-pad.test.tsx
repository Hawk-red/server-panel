/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Рендер пульта UGOOS на мок-данных: раскладка, подписи, серые кнопки, автоповтор, режим настройки.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { CommandPicker } from '@/features/receiver/remote-tab'
import { UGOOS_CFG, UGOOS_OFFLINE, UGOOS_ONLINE, UGOOS_PARTIAL_KEYS } from './ugoos-mock'
import { UgoosPad } from './ugoos-pad'

const noop = () => {}
const html = (over: { st?: typeof UGOOS_ONLINE | undefined; configure?: boolean; cfg?: typeof UGOOS_CFG | undefined } = {}) =>
  renderToStaticMarkup(<UgoosPad st={'st' in over ? over.st : UGOOS_ONLINE} cfg={'cfg' in over ? over.cfg : UGOOS_CFG} configure={over.configure ?? false} onPress={noop} onPick={noop} />)
const state = (h: string, id: string) => new RegExp(`data-key="${id}"[^>]*data-state="(\\w+)"`).exec(h)?.[1]
const command = (h: string, id: string) => new RegExp(`data-key="${id}" data-command="([^"]*)"`).exec(h)?.[1]

describe('пульт UGOOS SK1: рендер', () => {
  it('24 кнопки (12 назначенных + 12 без команды) и логотип внизу', () => {
    const h = html()
    assert.equal((h.match(/data-key="/g) ?? []).length, 24)
    assert.ok(h.includes('UGOOS'))
  })
  it('назначенные по умолчанию кнопки шлют правильные команды', () => {
    const h = html()
    assert.equal(command(h, 'power'), 'POWER')
    assert.equal(command(h, 'mute'), 'MUTE')
    assert.equal(command(h, 'dpad-up'), 'DPAD_UP')
    assert.equal(command(h, 'dpad-down'), 'DPAD_DOWN')
    assert.equal(command(h, 'dpad-left'), 'DPAD_LEFT')
    assert.equal(command(h, 'dpad-right'), 'DPAD_RIGHT')
    assert.equal(command(h, 'ok'), 'DPAD_CENTER')
    assert.equal(command(h, 'back'), 'BACK')
    assert.equal(command(h, 'home'), 'HOME')
    assert.equal(command(h, 'menu'), 'MENU')
    assert.equal(command(h, 'vol-up'), 'VOL_UP')
    assert.equal(command(h, 'vol-down'), 'VOL_DOWN')
  })
  it('кнопки без команды по умолчанию серые с подсказкой «команда не назначена»', () => {
    const h = html()
    for (const id of ['power2', 'cursor', 'settings', 'mic', 'arrow-up2', 'arrow-down2', 'app-1', 'app-2', 'app-3', 'app-4', 'app-5', 'app-6']) {
      assert.equal(state(h, id), 'off', id)
      assert.equal(command(h, id), '', id)
    }
    assert.match(h, /Курсор \(аэромышь\) — команда не назначена/)
    assert.match(h, /Микрофон — команда не назначена/)
  })
  it('бокс в сети и связан — все назначенные кнопки активны', () => {
    const h = html()
    for (const id of ['power', 'mute', 'dpad-up', 'ok', 'back', 'home', 'menu', 'vol-up', 'vol-down']) assert.equal(state(h, id), 'on', id)
  })
  it('бокс не отвечает — как у ИК-пульта: назначенные кнопки всё равно активны', () => {
    const h = html({ st: UGOOS_OFFLINE })
    assert.equal(state(h, 'power'), 'on')
    assert.equal(state(h, 'vol-up'), 'on')
  })
  it('бэкенд считает часть ключей «недоступной»: кнопки с привязкой всё равно активны (как у ИК-пульта)', () => {
    const h = html({ st: UGOOS_PARTIAL_KEYS })
    assert.equal(state(h, 'vol-up'), 'on')
    assert.equal(state(h, 'dpad-up'), 'on')
  })
  it('нет данных о боксе — кнопки с привязкой всё равно активны (12 из 24, остальные без команды); без привязок (cfg) — всё серое, без падения', () => {
    assert.equal((html({ st: undefined }).match(/data-state="on"/g) ?? []).length, 12)
    assert.equal((html({ cfg: undefined }).match(/data-state="on"/g) ?? []).length, 0)
  })
  it('кнопки с автоповтором (громкость, D-pad) и без него рендерятся и активны одинаково', () => {
    // Сама логика «что повторяется» — чистая функция isUgoosRepeatable (lib/ugoos-pad.test.ts); здесь
    // достаточно убедиться, что BasePadKey получает её через UgoosKey и раскладка не ломается
    const h = html()
    for (const id of ['vol-up', 'vol-down', 'dpad-up', 'dpad-down', 'dpad-left', 'dpad-right', 'power', 'mute', 'ok', 'back', 'home', 'menu']) assert.equal(state(h, id), 'on', id)
  })
  it('режим настройки: все 24 кнопки выбираются, изменённая помечена', () => {
    const cfg = { ...UGOOS_CFG, bindings: { ...UGOOS_CFG.bindings, cursor: 'MENU' } }
    const h = html({ configure: true, cfg, st: UGOOS_OFFLINE })
    assert.equal((h.match(/data-state="configure"/g) ?? []).length, 24)
    assert.equal((h.match(/bg-amber-400/g) ?? []).length, 1)
    assert.match(h, /Курсор \(аэромышь\): Меню/)
  })
  it('окно выбора ключа закрыто, пока кнопка не выбрана', () => {
    assert.equal(renderToStaticMarkup(<CommandPicker button={null} cfg={UGOOS_CFG} onClose={noop} onChoose={noop} />), '')
  })
})
