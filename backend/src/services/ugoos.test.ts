// UGOOS SK1: статус и отправка ключей через Home Assistant (подставной HA, настоящий бокс не трогается).
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, beforeEach, describe, it } from 'node:test'

let ugoos: typeof import('./ugoos.js')
let ha: typeof import('./ugoosHa.js')

const REMOTE = 'remote.android_tv_192_168_31_6'
const MEDIA = 'media_player.android_tv_192_168_31_6'
type Ent = { entityId: string; name: string; state: string; features: number; sourceList: string[]; muted: boolean | null }
const ent = (entityId: string, state = 'on', muted: boolean | null = null): Ent => ({ entityId, name: 'UGOOS SK1', state, features: 0, sourceList: [], muted })
const house = () => [ent(MEDIA), ent(REMOTE)]

let sent: { domain: string; service: string; entityId: string; data?: Record<string, unknown> }[]
let entities: Ent[]
let haFail: Error | null

before(async () => {
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'ugoos-test-'))
  process.env.HA_TOKEN = 'подставной-токен-для-тестов'
  ugoos = await import('./ugoos.js')
  ha = await import('./ugoosHa.js')
})
beforeEach(() => {
  sent = []
  haFail = null
  entities = house()
  ha.resetHa()
  ha.setHaReader(async () => {
    if (haFail) throw haFail
    return entities
  })
  ha.setHaService(async (o) => void sent.push({ domain: o.domain, service: o.service, entityId: o.entityId, data: o.data }))
  ugoos.resetStatus()
})

describe('белый список ключей UGOOS', () => {
  const WANT = ['POWER', 'HOME', 'BACK', 'MENU', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'DPAD_CENTER', 'VOL_UP', 'VOL_DOWN', 'MUTE']
  it('ровно заданные ключи, все проверены', () => {
    assert.deepEqual(Object.keys(ugoos.KEYS).sort(), [...WANT].sort())
    assert.ok(Object.values(ugoos.KEYS).every((k) => k.verified))
  })
  it('чужие ключи отклоняются без обращения к HA', async () => {
    for (const k of ['KEY_HOME', 'home', '', '__proto__', 'constructor', 'DPAD_UP\nHOME']) {
      await assert.rejects(() => ugoos.sendKey(k), (e: { code?: string }) => e.code === 'bad', JSON.stringify(k))
    }
    assert.equal(sent.length, 0)
  })
  it('повторяемые при удержании ключи — громкость и D-pad', () => {
    assert.deepEqual([...ugoos.QUIET_KEYS].sort(), ['DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'DPAD_UP', 'VOL_DOWN', 'VOL_UP'].sort())
  })
})

describe('кнопки идут в HA', () => {
  it('D-pad/HOME/BACK/MENU — remote.send_command', async () => {
    const r = await ugoos.sendKey('HOME')
    assert.deepEqual(sent, [{ domain: 'remote', service: 'send_command', entityId: REMOTE, data: { command: ['HOME'] } }])
    assert.match(r.via, /Home Assistant/)
  })
  it('громкость и mute — сервисы медиаплеера', async () => {
    await ugoos.sendKey('VOL_UP')
    assert.deepEqual(sent, [{ domain: 'media_player', service: 'volume_up', entityId: MEDIA, data: undefined }])
  })
  it('без remote-сущности D-pad недопустим', async () => {
    entities = [ent(MEDIA)]
    await assert.rejects(() => ugoos.sendKey('DPAD_UP'), (e: { code?: string; message: string }) => e.code === 'bad' && /через Home Assistant недоступна/.test(e.message))
    assert.equal(sent.length, 0)
  })
  it('бокса нет в HA: понятная ошибка, команда не уходит', async () => {
    entities = [ent('media_player.marantz')]
    await assert.rejects(() => ugoos.sendKey('MUTE'), (e: { code?: string; message: string }) => e.code === 'unpaired' && /Home Assistant/.test(e.message))
    assert.equal(sent.length, 0)
  })
  it('HA не ответил: понятная ошибка, статус серый', async () => {
    haFail = new Error('connect ECONNREFUSED 127.0.0.1:8123')
    await assert.rejects(() => ugoos.sendKey('MUTE'), (e: { code?: string; message: string }) => e.code === 'offline' && /Home Assistant/.test(e.message))
    const s = await ugoos.getStatus(true)
    assert.equal(s.online, false)
    assert.deepEqual(s.keys, [])
  })
})

describe('статус', () => {
  it('в сети, связь через HA, список рабочих ключей', async () => {
    const s = await ugoos.getStatus(true)
    assert.equal(s.online, true)
    assert.equal(s.paired, true)
    assert.equal(s.entity, MEDIA)
    assert.ok(s.keys.includes('HOME') && s.keys.includes('VOL_UP'))
  })
  it('только медиаплеер: D-pad отсутствует в списке рабочих ключей', async () => {
    entities = [ent(MEDIA)]
    const s = await ugoos.getStatus(true)
    assert.ok(s.keys.includes('VOL_UP'))
    assert.ok(!s.keys.includes('HOME'))
  })
  it('в статусе и в ответе нет токена', async () => {
    const r = await ugoos.sendKey('MUTE')
    const json = JSON.stringify({ status: await ugoos.getStatus(true), key: r, sent })
    assert.ok(!json.includes('подставной-токен'))
  })
})
