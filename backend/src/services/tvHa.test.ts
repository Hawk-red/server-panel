// Телевизор через Home Assistant: поиск сущностей, сопоставление кнопок с сервисами, белый список.
// Настоящий HA и телевизор не трогаются — только подставные данные.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, beforeEach, describe, it } from 'node:test'

let ha: typeof import('../services/tvHa.js')
let client: typeof import('../services/haClient.js')

type Ent = { entityId: string; name: string; state: string; features: number; sourceList: string[]; muted: boolean | null }
const ent = (entityId: string, name: string, state = 'on', features = 0, extra: Partial<Ent> = {}): Ent => ({ entityId, name, state, features, sourceList: [], muted: null, ...extra })

// как в этом доме: ресивер Marantz и телевизор Samsung (интеграция samsungtv даёт media_player и remote)
const TV_MEDIA = 'media_player.samsung_7_series_55_ue55tu7090uxua'
const TV_REMOTE = 'remote.samsung_7_series_55_ue55tu7090uxua'
const F = { PAUSE: 1, VOLUME_MUTE: 8, TURN_ON: 128, TURN_OFF: 256, VOLUME_STEP: 1024, SELECT_SOURCE: 2048, STOP: 4096, PLAY: 16_384 }
const FULL = F.PAUSE + F.VOLUME_MUTE + F.TURN_ON + F.TURN_OFF + F.VOLUME_STEP + F.SELECT_SOURCE + F.STOP + F.PLAY
const house = () => [ent('media_player.marantz', 'Marantz NR1604', 'off', FULL), ent(TV_MEDIA, 'Samsung 7 Series (55)', 'on', FULL), ent(TV_REMOTE, 'Samsung 7 Series (55)')]

before(async () => {
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'tvha-test-'))
  process.env.HA_TOKEN = 'подставной-токен-для-тестов' // без него findTv сразу отвечает «сущностей нет»
  ha = await import('./tvHa.js')
  client = await import('./haClient.js')
})
beforeEach(() => ha.resetHa())

const view = (list: Ent[]) => ({ ...ha.pickEntities(list), at: Date.now() })

describe('поиск сущностей телевизора', () => {
  it('берёт сущности Samsung, ресивер не трогает', () => {
    const v = view(house())
    assert.equal(v.media?.entityId, TV_MEDIA)
    assert.equal(v.remote?.entityId, TV_REMOTE)
  })
  it('телевизор узнаётся по имени, но не чужие медиаплееры', () => {
    assert.equal(ha.looksLikeTv(ent(TV_MEDIA, 'Samsung 7 Series (55)')), true)
    assert.equal(ha.looksLikeTv(ent('media_player.tv_zal', 'Телевизор в зале')), true)
    assert.equal(ha.looksLikeTv(ent('media_player.marantz', 'Marantz NR1604')), false)
    assert.equal(ha.looksLikeTv(ent('media_player.spotify', 'Spotify')), false)
  })
  it('ручная замена автопоиску (tv.haRemote / tv.haMedia)', () => {
    const list = [...house(), ent('media_player.tv_other', 'Телевизор на кухне')]
    assert.equal(ha.pickEntities(list, { media: 'media_player.tv_other' }).media?.entityId, 'media_player.tv_other')
    assert.equal(ha.pickEntities(list, { media: 'media_player.нет_такого' }).media, null)
  })
  it('сущностей нет — пусто, без падения', () => {
    const v = view([ent('media_player.marantz', 'Marantz NR1604')])
    assert.equal(v.media, null)
    assert.equal(ha.entityOf(v), null)
    assert.equal(ha.isLinked(v), false)
    assert.equal(ha.isOnline(v), false)
  })
})

describe('состояние телевизора', () => {
  it('«в сети» — отвечает и не выключен; «связь есть» — сущность доступна', () => {
    const on = view(house())
    assert.equal(ha.isOnline(on), true)
    assert.equal(ha.isLinked(on), true)
    const off = view([ent(TV_MEDIA, 'ТВ', 'off', FULL)])
    assert.equal(ha.isOnline(off), false)
    assert.equal(ha.isLinked(off), true) // выключенный, но известный HA
    const gone = view([ent(TV_MEDIA, 'ТВ', 'unavailable', FULL)])
    assert.equal(ha.isLinked(gone), false)
  })
  it('живое событие HA обновляет состояние без повторного чтения', async () => {
    ha.setHaReader(async () => house())
    const v = await ha.findTv(true)
    assert.equal(ha.isOnline(v), true)
    assert.equal(ha.applyTvLive(TV_MEDIA, 'off'), true)
    assert.equal(ha.isOnline(await ha.findTv()), false)
    assert.equal(ha.applyTvLive('media_player.marantz', 'on'), false) // чужая сущность не трогается
    ha.setHaReader(null)
  })
})

describe('сопоставление кнопок', () => {
  it('есть remote-сущность: любой ключ уходит как remote.send_command', () => {
    const v = view(house())
    for (const k of ['KEY_1', 'KEY_UP', 'KEY_MENU', 'KEY_VOLUP', 'KEY_SOURCE']) {
      assert.deepEqual(ha.planKey(k, v), { domain: 'remote', service: 'send_command', data: { command: [k] } }, k)
    }
  })
  it('только медиаплеер: громкость, mute, питание и воспроизведение — остальное серое', () => {
    const v = view([ent(TV_MEDIA, 'ТВ', 'on', FULL, { muted: false })])
    assert.deepEqual(ha.planKey('KEY_VOLUP', v), { domain: 'media_player', service: 'volume_up', data: undefined })
    assert.deepEqual(ha.planKey('KEY_VOLDOWN', v), { domain: 'media_player', service: 'volume_down', data: undefined })
    assert.deepEqual(ha.planKey('KEY_MUTE', v), { domain: 'media_player', service: 'volume_mute', data: { is_volume_muted: true } })
    assert.deepEqual(ha.planKey('KEY_POWER', v), { domain: 'media_player', service: 'turn_off', data: undefined })
    assert.deepEqual(ha.planKey('KEY_PLAY', v), { domain: 'media_player', service: 'media_play', data: undefined })
    assert.deepEqual(ha.planKey('KEY_PAUSE', v), { domain: 'media_player', service: 'media_pause', data: undefined })
    assert.deepEqual(ha.planKey('KEY_STOP', v), { domain: 'media_player', service: 'media_stop', data: undefined })
    for (const k of ['KEY_1', 'KEY_UP', 'KEY_DOWN', 'KEY_LEFT', 'KEY_RIGHT', 'KEY_MENU', 'KEY_SOURCE', 'KEY_CHUP', 'KEY_CHDOWN', 'KEY_INFO', 'KEY_RED']) {
      assert.equal(ha.planKey(k, v), null, k)
    }
  })
  it('mute переключается от текущего состояния звука', () => {
    const v = view([ent(TV_MEDIA, 'ТВ', 'on', FULL, { muted: true })])
    assert.deepEqual(ha.planKey('KEY_MUTE', v)?.data, { is_volume_muted: false })
  })
  it('выключенный ТВ включается только если HA это умеет', () => {
    const can = view([ent(TV_MEDIA, 'ТВ', 'off', F.TURN_ON)])
    assert.equal(ha.planKey('KEY_POWER', can)?.service, 'turn_on')
    const cannot = view([ent(TV_MEDIA, 'ТВ', 'off', F.TURN_OFF)])
    assert.equal(ha.planKey('KEY_POWER', cannot), null) // питание поднимет сцена
  })
  it('чего медиаплеер не умеет, то и не шлём (supported_features)', () => {
    const v = view([ent(TV_MEDIA, 'ТВ', 'on', 0)])
    for (const k of ['KEY_VOLUP', 'KEY_MUTE', 'KEY_PLAY', 'KEY_PAUSE', 'KEY_STOP', 'KEY_POWER']) assert.equal(ha.planKey(k, v), null, k)
  })
  it('недоступная сущность не получает команд', () => {
    const v = view([ent(TV_MEDIA, 'ТВ', 'unavailable', FULL), ent(TV_REMOTE, 'ТВ', 'unavailable')])
    assert.equal(ha.planKey('KEY_VOLUP', v), null)
  })
  it('список рабочих ключей для серых кнопок', () => {
    const all = ['KEY_VOLUP', 'KEY_MUTE', 'KEY_1', 'KEY_MENU']
    assert.deepEqual(ha.supportedKeys(all, view(house())), all)
    assert.deepEqual(ha.supportedKeys(all, view([ent(TV_MEDIA, 'ТВ', 'on', FULL)])), ['KEY_VOLUP', 'KEY_MUTE'])
  })
})

describe('белый список сервисов HA', () => {
  it('разрешены только send_command и перечисленные сервисы медиаплеера', () => {
    assert.deepEqual([...client.TV_DOMAINS], ['media_player', 'remote'])
    assert.deepEqual(client.TV_SERVICES.remote, ['send_command'])
    assert.deepEqual(client.TV_SERVICES.media_player, ['volume_up', 'volume_down', 'volume_mute', 'turn_on', 'turn_off', 'select_source', 'media_play', 'media_pause', 'media_stop', 'media_next_track', 'media_previous_track'])
  })
  it('чужой сервис, чужой домен и подменённая сущность отклоняются до обращения к HA', async () => {
    const calls: unknown[] = []
    const bad = [
      { domain: 'remote', service: 'turn_off', entityId: TV_REMOTE },
      { domain: 'media_player', service: 'play_media', entityId: TV_MEDIA },
      { domain: 'switch', service: 'turn_on', entityId: 'switch.kettle' },
      { domain: 'media_player', service: 'volume_up', entityId: TV_REMOTE }, // домен и сущность не совпадают
      { domain: 'media_player', service: 'volume_up', entityId: 'media_player.сосед; rm -rf' },
    ]
    for (const b of bad) {
      await assert.rejects(() => client.liveTvService({ url: 'http://127.0.0.1:8123', token: 'x', ...b }), /нельзя выполнить/, JSON.stringify(b))
    }
    assert.equal(calls.length, 0)
  })
  it('команда уходит только в найденную сущность телевизора, токен в вызове не разглашается', async () => {
    const seen: { domain: string; service: string; entityId: string; data?: Record<string, unknown> }[] = []
    ha.setHaService(async (o) => void seen.push({ domain: o.domain, service: o.service, entityId: o.entityId, data: o.data }))
    await ha.callKey('KEY_VOLUP', view(house()))
    assert.deepEqual(seen, [{ domain: 'remote', service: 'send_command', entityId: TV_REMOTE, data: { command: ['KEY_VOLUP'] } }])
    assert.ok(!JSON.stringify(seen).includes('token'))
    ha.setHaService(null)
  })
})
