// UGOOS SK1 через Home Assistant: сущности фиксированы в конфиге, сопоставление кнопок с сервисами, белый список.
// Настоящий HA и бокс не трогаются — только подставные данные.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, beforeEach, describe, it } from 'node:test'

let ha: typeof import('../services/ugoosHa.js')
let client: typeof import('../services/haClient.js')

type Ent = { entityId: string; name: string; state: string; features: number; sourceList: string[]; muted: boolean | null }
const ent = (entityId: string, name: string, state = 'on', features = 0, extra: Partial<Ent> = {}): Ent => ({ entityId, name, state, features, sourceList: [], muted: null, ...extra })

const REMOTE = 'remote.android_tv_192_168_31_6'
const MEDIA = 'media_player.android_tv_192_168_31_6'
const house = () => [ent('media_player.marantz', 'Marantz NR1604', 'off'), ent(MEDIA, 'UGOOS SK1', 'on'), ent(REMOTE, 'UGOOS SK1')]

before(async () => {
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'ugoosha-test-'))
  process.env.HA_TOKEN = 'подставной-токен-для-тестов' // без него findUgoos сразу отвечает «сущностей нет»
  ha = await import('./ugoosHa.js')
  client = await import('./haClient.js')
})
beforeEach(() => ha.resetHa())

describe('поиск сущностей бокса (фиксированные id из конфига)', () => {
  it('берёт сущности по точному совпадению, ресивер не трогает', async () => {
    ha.setHaReader(async () => house())
    const v = await ha.findUgoos(true)
    assert.equal(v.media?.entityId, MEDIA)
    assert.equal(v.remote?.entityId, REMOTE)
    ha.setHaReader(null)
  })
  it('сущностей нет — пусто, без падения', async () => {
    ha.setHaReader(async () => [ent('media_player.marantz', 'Marantz NR1604')])
    const v = await ha.findUgoos(true)
    assert.equal(v.media, null)
    assert.equal(ha.entityOf(v), null)
    assert.equal(ha.isLinked(v), false)
    assert.equal(ha.isOnline(v), false)
    ha.setHaReader(null)
  })
})

describe('состояние бокса', () => {
  it('«в сети» — отвечает и не выключен; «связь есть» — сущность доступна', async () => {
    ha.setHaReader(async () => house())
    const on = await ha.findUgoos(true)
    assert.equal(ha.isOnline(on), true)
    assert.equal(ha.isLinked(on), true)
    ha.setHaReader(async () => [ent(MEDIA, 'ТВ', 'off')])
    const off = await ha.findUgoos(true)
    assert.equal(ha.isOnline(off), false)
    assert.equal(ha.isLinked(off), true) // выключенный, но известный HA
    ha.setHaReader(async () => [ent(MEDIA, 'ТВ', 'unavailable')])
    const gone = await ha.findUgoos(true)
    assert.equal(ha.isLinked(gone), false)
    ha.setHaReader(null)
  })
  it('живое событие HA обновляет состояние без повторного чтения', async () => {
    ha.setHaReader(async () => house())
    const v = await ha.findUgoos(true)
    assert.equal(ha.isOnline(v), true)
    assert.equal(ha.applyUgoosLive(MEDIA, 'off'), true)
    assert.equal(ha.isOnline(await ha.findUgoos()), false)
    assert.equal(ha.applyUgoosLive('media_player.marantz', 'on'), false) // чужая сущность не трогается
    ha.setHaReader(null)
  })
})

describe('сопоставление кнопок', () => {
  it('D-pad/HOME/BACK/MENU уходят только через remote-сущность (ADB), как remote.send_command', async () => {
    ha.setHaReader(async () => house())
    const v = await ha.findUgoos(true)
    for (const k of ['HOME', 'BACK', 'MENU', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'DPAD_CENTER']) {
      assert.deepEqual(ha.planKey(k, v), { domain: 'remote', service: 'send_command', data: { command: [k] } }, k)
    }
    ha.setHaReader(null)
  })
  it('без remote-сущности D-pad недоступен (у медиаплеера аналога нет)', async () => {
    ha.setHaReader(async () => [ent(MEDIA, 'ТВ', 'on')])
    const v = await ha.findUgoos(true)
    for (const k of ['HOME', 'BACK', 'MENU', 'DPAD_UP', 'DPAD_CENTER']) assert.equal(ha.planKey(k, v), null, k)
    ha.setHaReader(null)
  })
  it('громкость, mute и питание — через медиаплеер', async () => {
    ha.setHaReader(async () => [ent(MEDIA, 'ТВ', 'on', 0, { muted: false })])
    const v = await ha.findUgoos(true)
    assert.deepEqual(ha.planKey('VOL_UP', v), { domain: 'media_player', service: 'volume_up' })
    assert.deepEqual(ha.planKey('VOL_DOWN', v), { domain: 'media_player', service: 'volume_down' })
    assert.deepEqual(ha.planKey('MUTE', v), { domain: 'media_player', service: 'volume_mute', data: { is_volume_muted: true } })
    assert.deepEqual(ha.planKey('POWER', v), { domain: 'media_player', service: 'turn_off' })
    ha.setHaReader(null)
  })
  it('mute переключается от текущего состояния звука', async () => {
    ha.setHaReader(async () => [ent(MEDIA, 'ТВ', 'on', 0, { muted: true })])
    const v = await ha.findUgoos(true)
    assert.deepEqual(ha.planKey('MUTE', v)?.data, { is_volume_muted: false })
    ha.setHaReader(null)
  })
  it('питание переключается от текущего состояния медиаплеера', async () => {
    ha.setHaReader(async () => [ent(MEDIA, 'ТВ', 'off')])
    const v = await ha.findUgoos(true)
    assert.equal(ha.planKey('POWER', v)?.service, 'turn_on')
    ha.setHaReader(null)
  })
  it('недоступная (unavailable) сущность всё равно получает команду — как у ИК-пульта, статус не проверяется', async () => {
    ha.setHaReader(async () => [ent(MEDIA, 'ТВ', 'unavailable'), ent(REMOTE, 'ТВ', 'unavailable')])
    const v = await ha.findUgoos(true)
    assert.deepEqual(ha.planKey('VOL_UP', v), { domain: 'media_player', service: 'volume_up' })
    assert.deepEqual(ha.planKey('HOME', v), { domain: 'remote', service: 'send_command', data: { command: ['HOME'] } })
    ha.setHaReader(null)
  })
  it('список рабочих ключей для серых кнопок', async () => {
    const all = ['VOL_UP', 'MUTE', 'HOME', 'MENU']
    ha.setHaReader(async () => house())
    assert.deepEqual(ha.supportedKeys(all, await ha.findUgoos(true)), all)
    ha.setHaReader(async () => [ent(MEDIA, 'ТВ', 'on')])
    assert.deepEqual(ha.supportedKeys(all, await ha.findUgoos(true)), ['VOL_UP', 'MUTE'])
    ha.setHaReader(null)
  })
})

describe('белый список сервисов HA (общий с tvHa.ts)', () => {
  it('разрешены только send_command и перечисленные сервисы медиаплеера', () => {
    assert.deepEqual([...client.TV_DOMAINS], ['media_player', 'remote'])
    assert.deepEqual(client.TV_SERVICES.remote, ['send_command'])
  })
  it('команда уходит только в сущность UGOOS из конфига, токен в вызове не разглашается', async () => {
    const seen: { domain: string; service: string; entityId: string; data?: Record<string, unknown> }[] = []
    ha.setHaReader(async () => house())
    ha.setHaService(async (o) => void seen.push({ domain: o.domain, service: o.service, entityId: o.entityId, data: o.data }))
    await ha.callKey('HOME', await ha.findUgoos(true))
    assert.deepEqual(seen, [{ domain: 'remote', service: 'send_command', entityId: REMOTE, data: { command: ['HOME'] } }])
    assert.ok(!JSON.stringify(seen).includes('token'))
    ha.setHaReader(null)
    ha.setHaService(null)
  })
})
