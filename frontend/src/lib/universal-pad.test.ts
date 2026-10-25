import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { draftButton, filterItems, nextId, SOURCE_LABEL, stripView, uniRepeatable, uniStatus, type UniButtonView } from './universal-pad.ts'

const tile = (over: Partial<UniButtonView> = {}): UniButtonView => ({
  id: 'uni-1', source: 'receiver', command: 'vol-up', label: 'Громче', icon: 'volume', color: 'green', resolved: 'MVUP', title: 'Громче', available: true, ...over,
})
const recvOn = { power: 'ON' as const, inputs: [{ code: 'TV', name: 'TV' }] }
const tvOn = { online: true, paired: true, driver: 'ha' as const, keys: ['KEY_UP', 'KEY_POWER'] }

describe('универсальный пульт: доступность плиток', () => {
  it('кнопка без команды серая', () => {
    assert.deepEqual(uniStatus(tile({ resolved: null, available: false }), { receiver: recvOn, tv: tvOn }), { enabled: false, reason: 'команда не назначена' })
  })
  it('ресивер: правила его пульта (выключен, чужой вход)', () => {
    const st = { receiver: recvOn, tv: tvOn }
    assert.equal(uniStatus(tile(), st).enabled, true)
    assert.equal(uniStatus(tile(), { ...st, receiver: { power: 'STANDBY', inputs: [] } }).reason, 'ресивер выключен')
    assert.equal(uniStatus(tile(), { ...st, receiver: undefined }).reason, 'нет связи с ресивером')
    const input = tile({ command: 'in-cblsat', resolved: 'SISAT/CBL' })
    assert.equal(uniStatus(input, st).reason, 'такого входа нет в списке ресивера')
    assert.equal(uniStatus(tile({ command: 'in-tv', resolved: 'SITV' }), st).enabled, true)
    // питание ресивера работает и из режима ожидания
    assert.equal(uniStatus(tile({ command: 'power', resolved: 'PWTOGGLE' }), { ...st, receiver: { power: 'STANDBY', inputs: [] } }).enabled, true)
  })
  it('телевизор: правила его пульта (нет сервиса в HA, ТВ не отвечает)', () => {
    const st = { receiver: recvOn, tv: tvOn }
    assert.equal(uniStatus(tile({ source: 'tv', resolved: 'KEY_UP' }), st).enabled, true)
    assert.equal(uniStatus(tile({ source: 'tv', resolved: 'KEY_MENU' }), st).reason, 'через Home Assistant недоступно')
    assert.equal(uniStatus(tile({ source: 'tv', resolved: 'KEY_UP' }), { ...st, tv: { ...tvOn, online: false } }).reason, 'ТВ не отвечает')
    assert.equal(uniStatus(tile({ source: 'tv', resolved: 'KEY_POWER' }), { ...st, tv: { ...tvOn, online: false } }).enabled, true) // питание — сценой
  })
  it('сцена: серая, пока недоступна', () => {
    const st = { receiver: recvOn, tv: tvOn }
    assert.equal(uniStatus(tile({ source: 'scene', command: 'scene.tv_on', resolved: 'scene.tv_on' }), st).enabled, true)
    assert.deepEqual(uniStatus(tile({ source: 'scene', command: 'scene.fire', resolved: 'scene.fire', available: false }), st), { enabled: false, reason: 'сцена недоступна' })
  })
  it('удержание — как на оригинальных пультах', () => {
    assert.equal(uniRepeatable(tile()), true) // MVUP
    assert.equal(uniRepeatable(tile({ source: 'tv', resolved: 'KEY_VOLUP' })), true)
    assert.equal(uniRepeatable(tile({ source: 'tv', resolved: 'KEY_MENU' })), false)
    assert.equal(uniRepeatable(tile({ source: 'scene', resolved: 'scene.tv_on' })), false)
    assert.equal(uniRepeatable(tile({ resolved: null })), false)
  })
})

describe('универсальный пульт: правка состава', () => {
  it('новый идентификатор не повторяет занятые', () => {
    assert.equal(nextId([]), 'uni-1')
    assert.equal(nextId([{ id: 'uni-1' }, { id: 'uni-2' }]), 'uni-3')
    assert.equal(nextId([{ id: 'tv-power' }]), 'uni-1')
  })
  it('черновик плитки берёт подпись и вид от выбранного', () => {
    const b = draftButton('scene', { command: 'scene.tv_on', title: 'TV ON', color: 'green', icon: 'tv' }, [{ id: 'uni-1' }])
    assert.deepEqual(b, { id: 'uni-2', source: 'scene', command: 'scene.tv_on', label: 'TV ON', icon: 'tv', color: 'green' })
    const t = draftButton('tv', { command: 'nav-up', title: 'Вверх' }, [])
    assert.equal(t.label, 'Вверх')
    assert.equal(t.source, 'tv')
    assert.equal(draftButton('receiver', { command: 'mute', title: 'м'.repeat(60) }, []).label.length, 40)
  })
  it('в сохранение уходит только модель кнопки, без полей сервера', () => {
    assert.deepEqual(stripView(tile()), { id: 'uni-1', source: 'receiver', command: 'vol-up', label: 'Громче', icon: 'volume', color: 'green' })
  })
  it('поиск по названию и команде', () => {
    const list = [{ command: 'vol-up', title: 'Громче' }, { command: 'nav-up', title: 'Вверх' }]
    assert.deepEqual(filterItems(list, 'гром').map((x) => x.command), ['vol-up'])
    assert.deepEqual(filterItems(list, 'nav').map((x) => x.command), ['nav-up'])
    assert.equal(filterItems(list, '').length, 2)
  })
  it('подписи источников', () => {
    assert.deepEqual(Object.values(SOURCE_LABEL), ['Ресивер', 'Телевизор', 'Сцена'])
  })
})
