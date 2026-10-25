// Страница «Home Assistant»: сводка состояния на подставных ответах. Реальный HA не вызывается, токен в ответ не попадает.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, beforeEach, describe, it } from 'node:test'
import type { HaDevice } from './haClient.js'

let page: typeof import('./haPage.js')
let store: typeof import('./smarthome.js')
let hc: typeof import('./haClient.js')

const TOKEN = 'подставной-токен-для-тестов'
const dev = (id: string, name: string, available = true): HaDevice => ({
  id, name, manufacturer: 'Samsung', model: 'UE55', integration: 'samsungtv', area: null, available,
  summary: { text: 'доступно', tone: 'neutral', extras: [] }, controls: [], icon: 'speaker',
})

before(async () => {
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'ha-page-test-'))
  process.env.HA_TOKEN = TOKEN // без токена панель даже не пытается читать HA
  hc = await import('./haClient.js')
  store = await import('./smarthome.js')
  page = await import('./haPage.js')
})
beforeEach(() => {
  page.resetVersionCache()
  page.setVersionReader(async () => ({ version: '2026.9.3', locationName: 'Дом' }))
})

describe('сводка состояния', () => {
  it('HA в сети: статус ok, версия и число устройств из синхронизации', async () => {
    await store.syncHa({ reader: async () => ({ devices: [dev('d-tv', 'Телевизор'), dev('d-lamp', 'Лампа', false)], scenes: [{ entityId: 'scene.tv_on', name: 'TV ON', available: true }] }) })
    const s = await page.pageStatus()
    assert.equal(s.status, 'ok')
    assert.equal(s.configured, true)
    assert.equal(s.message, null)
    assert.equal(s.devices, 2)
    assert.equal(s.devicesOnline, 1)
    assert.equal(s.scenes, 1)
    assert.equal(s.version, '2026.9.3')
    assert.equal(s.locationName, 'Дом')
    assert.ok(s.syncedAt && s.syncedAt > 0)
  })
  it('версия читается не чаще раза в 10 минут', async () => {
    let calls = 0
    page.setVersionReader(async () => (calls++, { version: '2026.9.3', locationName: 'Дом' }))
    await page.loadVersion(1000)
    await page.loadVersion(1000 + page.VERSION_TTL_MS - 1)
    assert.equal(calls, 1)
    await page.loadVersion(1000 + page.VERSION_TTL_MS + 1)
    assert.equal(calls, 2)
  })
  it('токен не принят: статус unauthorized и понятное сообщение', async () => {
    await store.syncHa({
      reader: async () => {
        throw new hc.HaError('unauthorized', 'Home Assistant отклонил токен (401): создайте новый токен доступа')
      },
    })
    const s = await page.pageStatus()
    assert.equal(s.status, 'unauthorized')
    assert.match(s.message ?? '', /отклонил токен/)
  })
  it('HA недоступен: статус unavailable', async () => {
    await store.syncHa({
      reader: async () => {
        throw new hc.HaError('unavailable', 'Home Assistant недоступен')
      },
    })
    assert.equal((await page.pageStatus()).status, 'unavailable')
  })
  it('версия недоступна — страница всё равно отвечает', async () => {
    await store.syncHa({ reader: async () => ({ devices: [], scenes: [] }) })
    page.setVersionReader(async () => {
      throw new hc.HaError('unavailable', 'Home Assistant недоступен')
    })
    const s = await page.pageStatus()
    assert.equal(s.status, 'ok')
    assert.equal(s.version, null)
  })
  it('в ответе нет токена', async () => {
    await store.syncHa({ reader: async () => ({ devices: [dev('d-tv', 'Телевизор')], scenes: [] }) })
    const text = JSON.stringify(await page.pageStatus())
    assert.equal(text.includes(TOKEN), false)
    assert.equal(/token/i.test(text), false)
  })
})
