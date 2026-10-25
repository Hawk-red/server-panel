import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { HA_SHORTCUTS, haStatusView, type HaPageStatus } from './homeassistant.ts'

const s = (over: Partial<HaPageStatus> = {}): HaPageStatus => ({
  configured: true, status: 'ok', message: null, syncedAt: Date.now(), live: true, devices: 7, devicesOnline: 6, scenes: 3, version: '2026.9.3', locationName: 'Дом', ...over,
})

describe('страница «Home Assistant»: состояние связи', () => {
  it('в сети / недоступен / токен не принят / токен не задан', () => {
    assert.deepEqual(haStatusView(s()), { status: 'ok', label: 'в сети', hint: null })
    assert.equal(haStatusView(s({ status: 'unavailable', message: 'Home Assistant недоступен' })).label, 'недоступен')
    assert.equal(haStatusView(s({ status: 'unavailable' })).status, 'error')
    assert.equal(haStatusView(s({ status: 'unauthorized', message: 'Home Assistant отклонил токен (401)' })).label, 'токен не принят')
    assert.match(haStatusView(s({ status: 'unauthorized', message: 'Home Assistant отклонил токен (401)' })).hint ?? '', /отклонил токен/)
    assert.equal(haStatusView(s({ status: 'no-token', configured: false })).label, 'токен не задан')
    assert.equal(haStatusView(s({ status: 'no-token' })).status, 'warning')
  })
  it('пока ответа нет — «проверяю…», при ошибке запроса — «нет данных»', () => {
    assert.equal(haStatusView(undefined).label, 'проверяю…')
    assert.equal(haStatusView(s({ status: 'pending' })).label, 'проверяю…')
    assert.equal(haStatusView(s(), true).label, 'нет данных')
  })
  it('неизвестная ошибка показывает сообщение сервера', () => {
    assert.deepEqual(haStatusView(s({ status: 'error', message: 'что-то пошло не так' })), { status: 'error', label: 'ошибка', hint: 'что-то пошло не так' })
  })
})

describe('страница «Home Assistant»: ярлыки и ссылки', () => {
  it('пять ярлыков со стандартными путями HA', () => {
    assert.deepEqual(HA_SHORTCUTS.map((l) => l.path), ['/', '/config/devices/dashboard', '/config/integrations/dashboard', '/config/automation/dashboard', '/hacs'])
    assert.deepEqual(HA_SHORTCUTS.map((l) => l.title), ['Обзор', 'Устройства и службы', 'Интеграции', 'Автоматизации', 'HACS'])
  })
  it('адрес берётся из общего реестра ссылок (служба homeassistant), своей настройки адреса нет', () => {
    const src = readFileSync(new URL('../features/homeassistant/index.tsx', import.meta.url), 'utf8')
    assert.match(src, /service='homeassistant'/)
    assert.match(src, /Открыть Home Assistant/)
    assert.ok(!/8123|HA_PUBLIC_URL/.test(src))
    assert.ok(!/api\.post|api\.put|api\.delete/.test(src)) // страница только читает
  })
  it('маршрут /homeassistant есть в дереве маршрутов', () => {
    assert.match(readFileSync(new URL('../routeTree.gen.ts', import.meta.url), 'utf8'), /'\/_authenticated\/homeassistant\/'/)
  })
})
