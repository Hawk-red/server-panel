// Тесты драйвера телевизора: прямое подключение (подставной сокет и проверка портов) и режим Home Assistant (подставной HA).
// Настоящий телевизор не трогается.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, beforeEach, describe, it } from 'node:test'

let tv: typeof import('../services/tv.js')
let remote: typeof import('../services/tvRemote.js')
let st: typeof import('../settings.js')
let mask: typeof import('../mask.js')
let cfg: typeof import('../config.js')

const SECRET = '12345678'
let open: Set<number>
let socks: (EventEmitter & { sent: string[]; url: string; closed: boolean })[]
let behaviour: 'ok' | 'unauthorized' | 'silent' | 'noToken' | 'lateToken' | 'error'
let tokenAuth: boolean | null // что ТВ отвечает про TokenAuthSupport

const fakeFactory = (url: string) => {
  const ws = new EventEmitter() as EventEmitter & { sent: string[]; url: string; closed: boolean; send: (d: string, cb?: (e?: Error) => void) => void; close: () => void; terminate: () => void }
  ws.sent = []
  ws.url = url
  ws.closed = false
  ws.send = (d, cb) => {
    ws.sent.push(d)
    cb?.()
  }
  ws.close = () => void (ws.closed = true)
  ws.terminate = () => void (ws.closed = true)
  socks.push(ws)
  setTimeout(() => {
    if (behaviour === 'ok') ws.emit('message', Buffer.from(JSON.stringify({ event: 'ms.channel.connect', data: { token: SECRET } })))
    else if (behaviour === 'noToken') ws.emit('message', Buffer.from(JSON.stringify({ event: 'ms.channel.connect', data: {} })))
    else if (behaviour === 'lateToken') {
      // как настоящий Tizen: сначала connect без токена, токен — только после «Разрешить» на экране
      ws.emit('message', Buffer.from(JSON.stringify({ event: 'ms.channel.connect', data: {} })))
      setTimeout(() => ws.emit('message', Buffer.from(JSON.stringify({ event: 'ms.channel.connect', data: { token: SECRET } }))), 10)
    }
    else if (behaviour === 'unauthorized') ws.emit('message', Buffer.from(JSON.stringify({ event: 'ms.channel.unauthorized' })))
    else if (behaviour === 'error') ws.emit('error', new Error(`connect ECONNREFUSED ${url}`))
  }, 1)
  return ws as never
}

before(async () => {
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'tv-test-'))
  process.env.HA_TOKEN = 'подставной-токен-для-тестов' // config читает env при импорте; без токена режим HA сразу отвечает «сущностей нет»
  tv = await import('./tv.js')
  remote = await import('./tvRemote.js')
  st = await import('../settings.js')
  mask = await import('../mask.js')
  cfg = await import('../config.js')
})
beforeEach(() => {
  open = new Set([8001, 8002])
  socks = []
  behaviour = 'ok'
  tokenAuth = true
  tv.forgetPairing()
  tv.resetStatus()
  tv.resetInfo()
  tv.resetRate()
  Object.assign(tv.timing, { probeMs: 20, statusCacheMs: 0, connectMs: 100, pairMs: 120, lateTokenMs: 40, sendMs: 100, afterSendMs: 20, rateWindowMs: 1000, rateMax: 5, infoMs: 20, infoCacheMs: 0 })
  tv.setDriver('direct') // наборы ниже проверяют прямое подключение; режим Home Assistant — в конце файла
  tv.setProbe(async (_h, port) => open.has(port))
  tv.setWsFactory(fakeFactory)
  tv.setInfoFetch(async () => (tokenAuth === null ? Promise.reject(new Error('ТВ не ответил')) : { device: { TokenAuthSupport: tokenAuth, modelName: 'UE55TU7090' } }))
})
const pairNow = () => tv.pair()
const sentKeys = () => socks.flatMap((s) => s.sent.map((x) => JSON.parse(x).params.DataOfCmd))

describe('белый список ключей', () => {
  // KEY_TOPMENU и KEY_CAPTION — документированные замены для E-MANUAL и AD/SUBT., по умолчанию ни на одной кнопке не стоят
  const WANT = ['KEY_POWER', ...Array.from({ length: 10 }, (_, i) => `KEY_${i}`), 'KEY_SOURCE', 'KEY_VOLUP', 'KEY_VOLDOWN', 'KEY_MUTE', 'KEY_CHUP', 'KEY_CHDOWN', 'KEY_CH_LIST', 'KEY_PRECH', 'KEY_TTX_MIX', 'KEY_CONTENTS', 'KEY_MENU', 'KEY_GUIDE', 'KEY_TOOLS', 'KEY_INFO', 'KEY_UP', 'KEY_DOWN', 'KEY_LEFT', 'KEY_RIGHT', 'KEY_ENTER', 'KEY_RETURN', 'KEY_EXIT', 'KEY_RED', 'KEY_GREEN', 'KEY_YELLOW', 'KEY_CYAN', 'KEY_EMANUAL', 'KEY_PICTURE_SIZE', 'KEY_AD', 'KEY_TOPMENU', 'KEY_CAPTION', 'KEY_STOP', 'KEY_REWIND', 'KEY_PLAY', 'KEY_PAUSE', 'KEY_FF']
  it('ровно заданные ключи', () => {
    assert.deepEqual(Object.keys(tv.KEYS).sort(), [...WANT].sort())
  })
  it('чужие ключи отклоняются без обращения к сети', async () => {
    for (const k of ['KEY_POWEROFF', 'KEY_HDMI', 'key_power', 'KEY_', '', 'KEY_UP\nKEY_DOWN', '__proto__', 'constructor', 'KEY_FACTORY']) {
      await assert.rejects(() => tv.sendKey(k), (e: { code?: string }) => e.code === 'bad', JSON.stringify(k))
    }
    assert.equal(socks.length, 0)
  })
  it('непроверенные ключи помечены, остальные — нет', () => {
    const unv = Object.entries(tv.KEYS).filter(([, v]) => !v.verified).map(([k]) => k).sort()
    assert.deepEqual(unv, ['KEY_AD', 'KEY_CAPTION', 'KEY_CH_LIST', 'KEY_CONTENTS', 'KEY_EMANUAL', 'KEY_PICTURE_SIZE', 'KEY_TOPMENU', 'KEY_TTX_MIX'])
    assert.ok(remote.commandCatalog().filter((c) => !c.verified).every((c) => c.title.includes('не проверено')))
  })
})

describe('статус', () => {
  it('ТВ не отвечает: online=false, порт null', async () => {
    open.clear()
    const s = await tv.getStatus(true)
    assert.equal(s.online, false)
    assert.equal(s.port, null)
    assert.equal(s.host, cfg.config.tv.host)
  })
  it('порт 8002 предпочтительнее 8001; только 8001 — ws', async () => {
    assert.equal((await tv.getStatus(true)).port, 8002)
    open.delete(8002)
    assert.equal((await tv.getStatus(true)).port, 8001)
  })
  it('в статусе видно, нужен ли ТВ токен; «в сети» и «сопряжён» — разные поля', async () => {
    const s = await tv.getStatus(true)
    assert.equal(s.online, true)
    assert.equal(s.tokenAuth, true)
    assert.equal(s.paired, false) // сокет открывается у всех, но сопряжения ещё нет
    tokenAuth = false
    tv.resetInfo()
    assert.equal((await tv.getStatus(true)).tokenAuth, false)
    tokenAuth = null // ТВ не ответил
    tv.resetInfo()
    assert.equal((await tv.getStatus(true)).tokenAuth, null)
  })
  it('в статусе нет токена', async () => {
    await pairNow()
    const json = JSON.stringify(await tv.getStatus(true))
    assert.ok(!json.includes(SECRET))
    assert.equal(JSON.parse(json).paired, true)
  })
})

describe('отправка ключа', () => {
  it('ТВ не отвечает: понятная ошибка, сокет не открывается', async () => {
    open.clear()
    await assert.rejects(() => tv.sendKey('KEY_MUTE'), (e: { code?: string; message: string }) => e.code === 'offline' && /не отвечает/.test(e.message))
    assert.equal(socks.length, 0)
  })
  it('без сопряжения ключ не уходит', async () => {
    await assert.rejects(() => tv.sendKey('KEY_MUTE'), (e: { code?: string }) => e.code === 'unpaired')
    assert.equal(socks.length, 0)
  })
  it('после сопряжения: короткая сессия, формат команды как у Samsung, токен в адресе, сокет закрыт', async () => {
    await pairNow()
    socks.length = 0
    await tv.sendKey('KEY_VOLUP')
    assert.equal(socks.length, 1)
    assert.match(socks[0].url, /^wss:\/\/.+:8002\/api\/v2\/channels\/samsung\.remote\.api\.v2\?name=U2VydmVyUGFuZWw=&token=12345678$/)
    assert.deepEqual(JSON.parse(socks[0].sent[0]), { method: 'ms.remote.control', params: { Cmd: 'Click', DataOfCmd: 'KEY_VOLUP', Option: 'false', TypeOfRemote: 'SendRemoteKey' } })
    assert.equal(socks[0].closed, true)
  })
  it('если открыт только 8001 — ws без шифрования', async () => {
    await pairNow()
    open.delete(8002)
    socks.length = 0
    await tv.sendKey('KEY_MENU')
    assert.match(socks[0].url, /^ws:\/\/.+:8001\//)
  })
  it('обрыв: понятная русская ошибка без токена', async () => {
    await pairNow()
    behaviour = 'error'
    await assert.rejects(() => tv.sendKey('KEY_INFO'), (e: Error) => /Ошибка связи с телевизором/.test(e.message) && !e.message.includes(SECRET))
  })
  it('ТВ не разрешил (unauthorized): ошибка denied', async () => {
    await pairNow()
    behaviour = 'unauthorized'
    await assert.rejects(() => tv.sendKey('KEY_INFO'), (e: { code?: string }) => e.code === 'denied')
  })
  it('повтор после обрыва: следующая команда открывает новое соединение', async () => {
    await pairNow()
    behaviour = 'error'
    await assert.rejects(() => tv.sendKey('KEY_INFO'))
    behaviour = 'ok'
    socks.length = 0
    await tv.sendKey('KEY_INFO')
    assert.equal(sentKeys().join(), 'KEY_INFO')
  })
  it('не больше 5 ключей в секунду', async () => {
    await pairNow()
    let ok = 0
    let limited = 0
    for (let i = 0; i < 9; i++) await tv.sendKey('KEY_UP').then(() => ok++, (e: { code?: string }) => e.code === 'rate' && limited++)
    assert.equal(ok, 5)
    assert.equal(limited, 4)
  })
  it('лимит восстанавливается через окно', async () => {
    await pairNow()
    tv.timing.afterSendMs = 0
    for (let i = 0; i < 5; i++) await tv.sendKey('KEY_UP')
    await assert.rejects(() => tv.sendKey('KEY_UP'), (e: { code?: string }) => e.code === 'rate')
    tv.timing.rateWindowMs = 10 // окно прошло
    await new Promise((r) => setTimeout(r, 20))
    await tv.sendKey('KEY_UP')
  })
  it('ТВ ответил ошибкой на команду — это не «ок»', async () => {
    await pairNow()
    const base = fakeFactory
    tv.setWsFactory((url) => {
      const w = base(url) as unknown as EventEmitter & { send: (d: string, cb?: (e?: Error) => void) => void }
      const orig = w.send.bind(w)
      w.send = (d, cb) => {
        orig(d, cb)
        setTimeout(() => w.emit('message', Buffer.from(JSON.stringify({ event: 'ms.error', data: { message: 'unrecognized method value' } }))), 1)
      }
      return w as never
    })
    await assert.rejects(() => tv.sendKey('KEY_MUTE'), (e: { code?: string; message: string }) => e.code === 'denied' && /отклонил команду/.test(e.message))
  })
  it('ТВ ответил unauthorized после команды — понятная ошибка, а не «ок»', async () => {
    await pairNow()
    const base = fakeFactory
    tv.setWsFactory((url) => {
      const w = base(url) as unknown as EventEmitter & { send: (d: string, cb?: (e?: Error) => void) => void }
      const orig = w.send.bind(w)
      w.send = (d, cb) => {
        orig(d, cb)
        setTimeout(() => w.emit('message', Buffer.from(JSON.stringify({ event: 'ms.channel.unauthorized' }))), 1)
      }
      return w as never
    })
    await assert.rejects(() => tv.sendKey('KEY_MUTE'), (e: { code?: string; message: string }) => e.code === 'denied' && /Менеджер подключения устройств/.test(e.message))
  })
  it('сокет закрывается не сразу: ТВ успевает выполнить команду', async () => {
    await pairNow()
    socks.length = 0
    tv.timing.afterSendMs = 60
    const t0 = Date.now()
    await tv.sendKey('KEY_MUTE')
    assert.ok(Date.now() - t0 >= 55, 'ждали ответа ТВ перед закрытием')
    assert.equal(socks[0].closed, true)
  })
  it('KEY_POWER при недоступном ТВ не открывает сокет (питание в этом случае — сцена, решает страница)', async () => {
    await pairNow()
    open.clear()
    socks.length = 0
    await assert.rejects(() => tv.sendKey('KEY_POWER'), (e: { code?: string }) => e.code === 'offline')
    assert.equal(socks.length, 0)
    assert.equal(cfg.config.tv.sceneOn, 'scene.tv_on')
  })
})

describe('сопряжение и токен', () => {
  it('токен сохраняется зашифрованным и не лежит в открытом виде', async () => {
    await pairNow()
    const raw = JSON.stringify(st.getSetting('tv.token', null))
    assert.ok(raw.startsWith('"v1.'))
    assert.ok(!raw.includes(SECRET))
    assert.equal(tv.isPaired(), true)
  })
  it('сопряжение без токена в адресе; без разрешения — таймаут с понятным текстом', async () => {
    behaviour = 'silent'
    await assert.rejects(() => pairNow(), (e: { code?: string; message: string }) => e.code === 'timeout' && /Разрешить/.test(e.message))
    assert.ok(!socks[0].url.includes('token='))
    assert.equal(tv.isPaired(), false)
  })
  it('сопряжение при недоступном ТВ — offline', async () => {
    open.clear()
    await assert.rejects(() => pairNow(), (e: { code?: string }) => e.code === 'offline')
  })
  it('ТВ без токенов (TokenAuthSupport=false): сопряжение проходит в режиме «open», ключи идут без токена', async () => {
    behaviour = 'noToken'
    tokenAuth = false
    assert.deepEqual(await pairNow(), { paired: true, mode: 'open' })
    assert.equal(tv.isPaired(), true)
    await tv.sendKey('KEY_MUTE')
    assert.ok(!socks.at(-1)!.url.includes('token='))
  })
  it('ТВ требует токен, но не выдал его: сопряжения нет, в ошибке — что сделать на телевизоре', async () => {
    behaviour = 'noToken' // то, что делает UE55TU7090: сокет пускает, окна «Разрешить» нет, токена нет
    await assert.rejects(
      () => pairNow(),
      (e: { code?: string; message: string }) => e.code === 'denied' && /Менеджер подключения устройств/.test(e.message) && /Разрешить/.test(e.message),
    )
    assert.equal(tv.isPaired(), false)
    assert.equal(st.getSetting('tv.token', null), null)
  })
  it('ТВ не ответил о себе (tokenAuth неизвестен): без токена сопряжения тоже нет', async () => {
    behaviour = 'noToken'
    tokenAuth = null
    await assert.rejects(() => pairNow(), (e: { code?: string }) => e.code === 'denied')
    assert.equal(tv.isPaired(), false)
  })
  it('токен пришёл поздно (владелец нажал «Разрешить»): сопряжение удалось', async () => {
    behaviour = 'lateToken'
    assert.deepEqual(await pairNow(), { paired: true, mode: 'token' })
    assert.equal(tv.isPaired(), true)
    socks.length = 0
    behaviour = 'ok'
    await tv.sendKey('KEY_MUTE')
    assert.match(socks[0].url, /token=12345678$/)
  })
  it('ТВ отказал (unauthorized): сопряжения нет, в ошибке — что сделать на телевизоре', async () => {
    behaviour = 'unauthorized'
    await assert.rejects(() => pairNow(), (e: { code?: string; message: string }) => e.code === 'denied' && /Менеджер подключения устройств/.test(e.message))
    assert.equal(tv.isPaired(), false)
  })
  it('остатки первой версии (tv.paired=true с пустым токеном) сопряжением не считаются', async () => {
    st.setSetting('tv.paired', true)
    st.setSetting('tv.token', null)
    assert.equal(tv.isPaired(), false)
    await assert.rejects(() => tv.sendKey('KEY_MUTE'), (e: { code?: string; message: string }) => e.code === 'unpaired' && /Сопрячь/.test(e.message))
    assert.equal(socks.length, 0)
  })
  it('обновлённый токен из ответа ТВ сохраняется', async () => {
    await pairNow()
    const before = st.getSetting('tv.token', '')
    await tv.sendKey('KEY_MUTE')
    assert.notEqual(st.getSetting('tv.token', ''), null)
    assert.equal(typeof before, 'string')
  })
})

describe('маскирование токена', () => {
  it('в адресе сокета и в JSON токен скрывается', () => {
    const s = mask.maskSecrets(`wss://tv:8002/api/v2/channels/samsung.remote.api.v2?name=x&token=${SECRET} {"token":"${SECRET}"}`)
    assert.ok(!s.includes(SECRET))
    assert.match(s, /token=<скрыто>/)
  })
  it('сообщения об ошибках драйвера проходят через mask', async () => {
    await pairNow()
    tv.setWsFactory((url) => {
      const w = fakeFactory(url) as unknown as EventEmitter
      setTimeout(() => w.emit('error', new Error(`bad ${url}`)), 0)
      return w as never
    })
    behaviour = 'silent'
    await assert.rejects(() => tv.sendKey('KEY_MUTE'), (e: Error) => !e.message.includes(SECRET) && e.message.includes('<скрыто>'))
  })
})

describe('привязки tv.remote', () => {
  beforeEach(() => st.setSetting(remote.SETTING_KEY, {}))
  it('умолчания — из белого списка; кнопок 44', () => {
    for (const [b, k] of Object.entries(remote.REMOTE_DEFAULTS)) assert.ok(k === null || tv.isKey(k), b)
    assert.equal(remote.REMOTE_BUTTONS.length, 44)
  })
  it('назначение, null и сброс', () => {
    remote.setBinding('emanual', 'KEY_MENU')
    assert.equal(remote.getBindings().emanual, 'KEY_MENU')
    remote.setBinding('emanual', null)
    assert.equal(remote.getBindings().emanual, null)
    remote.setBinding('emanual', undefined)
    assert.equal(remote.getBindings().emanual, 'KEY_EMANUAL')
    assert.deepEqual(st.getSetting(remote.SETTING_KEY, {}), {})
  })
  it('чужие ключи и кнопки отклоняются', () => {
    for (const k of ['KEY_HDMI', '', 'MVUP']) assert.throws(() => remote.setBinding('ad', k), (e: { code?: string }) => e.code === 'bad')
    for (const b of ['__proto__', 'nope']) assert.throws(() => remote.setBinding(b, 'KEY_MENU'), (e: { code?: string }) => e.code === 'bad')
  })
  it('испорченные записи игнорируются', () => {
    st.setSetting(remote.SETTING_KEY, { ad: 'KEY_FACTORY', nope: 'KEY_MENU', stop: 5, play: 'KEY_PAUSE' })
    const b = remote.getBindings()
    assert.equal(b.ad, 'KEY_AD')
    assert.equal(b.play, 'KEY_PAUSE')
    assert.ok(!('nope' in b))
  })
})

// ---------- режим Home Assistant (по умолчанию) ----------
const TV_MEDIA = 'media_player.samsung_7_series_55_ue55tu7090uxua'
const TV_REMOTE = 'remote.samsung_7_series_55_ue55tu7090uxua'
const entity = (entityId: string, state = 'on', features = 0, muted: boolean | null = null) => ({
  entityId,
  name: entityId.includes('marantz') ? 'Marantz NR1604' : 'Samsung 7 Series (55)',
  state,
  features,
  sourceList: [],
  muted,
})
const MEDIA_FULL = 1 + 8 + 128 + 256 + 1024 + 2048 + 4096 + 16_384

describe('телевизор через Home Assistant', () => {
  let sent: { domain: string; service: string; entityId: string; data?: Record<string, unknown> }[]
  let entities: ReturnType<typeof entity>[]
  let haFail: Error | null

  beforeEach(async () => {
    sent = []
    haFail = null
    entities = [entity('media_player.marantz', 'off', MEDIA_FULL), entity(TV_MEDIA, 'on', MEDIA_FULL, false), entity(TV_REMOTE)]
    const ha = await import('./tvHa.js')
    ha.resetHa()
    ha.setHaReader(async () => {
      if (haFail) throw haFail
      return entities
    })
    ha.setHaService(async (o) => void sent.push({ domain: o.domain, service: o.service, entityId: o.entityId, data: o.data }))
    tv.setDriver('ha')
    tv.resetStatus()
  })

  it('кнопки идут в HA как remote.send_command, сокет к телевизору не открывается', async () => {
    const r = await tv.sendKey('KEY_VOLUP')
    assert.deepEqual(sent, [{ domain: 'remote', service: 'send_command', entityId: TV_REMOTE, data: { command: ['KEY_VOLUP'] } }])
    assert.match(r.via, /Home Assistant/)
    assert.equal(socks.length, 0)
  })
  it('только медиаплеер: громкость идёт сервисом, цифры и стрелки — недопустимая кнопка', async () => {
    entities = [entity(TV_MEDIA, 'on', MEDIA_FULL, false)]
    await tv.sendKey('KEY_VOLDOWN')
    assert.deepEqual(sent, [{ domain: 'media_player', service: 'volume_down', entityId: TV_MEDIA, data: undefined }])
    await assert.rejects(() => tv.sendKey('KEY_1'), (e: { code?: string; message: string }) => e.code === 'bad' && /через Home Assistant недоступна/.test(e.message))
    assert.equal(sent.length, 1)
  })
  it('чужие ключи не уходят в HA', async () => {
    for (const k of ['KEY_HDMI', '__proto__', 'volume_up']) await assert.rejects(() => tv.sendKey(k), (e: { code?: string }) => e.code === 'bad')
    assert.equal(sent.length, 0)
  })
  it('статус: в сети, связь через HA, список рабочих кнопок', async () => {
    const s = await tv.getStatus(true)
    assert.equal(s.driver, 'ha')
    assert.equal(s.online, true)
    assert.equal(s.paired, true)
    assert.equal(s.entity, TV_MEDIA)
    assert.ok(s.keys.includes('KEY_1') && s.keys.includes('KEY_MENU'))
    assert.equal(s.port, null)
  })
  it('статус без remote-сущности: часть кнопок в списке отсутствует', async () => {
    entities = [entity(TV_MEDIA, 'on', MEDIA_FULL, false)]
    const s = await tv.getStatus(true)
    assert.ok(s.keys.includes('KEY_VOLUP'))
    assert.ok(!s.keys.includes('KEY_1'))
    assert.ok(!s.keys.includes('KEY_UP'))
  })
  it('телевизора нет в HA: статус не «в сети», ключи не уходят', async () => {
    entities = [entity('media_player.marantz', 'on', MEDIA_FULL)]
    const s = await tv.getStatus(true)
    assert.equal(s.online, false)
    assert.equal(s.paired, false)
    assert.deepEqual(s.keys, [])
    await assert.rejects(() => tv.sendKey('KEY_MUTE'), (e: { code?: string; message: string }) => e.code === 'unpaired' && /Home Assistant/.test(e.message))
    assert.equal(sent.length, 0)
  })
  it('выключенный ТВ: обычные кнопки не уходят (питание поднимает сцена)', async () => {
    entities = [entity(TV_MEDIA, 'off', MEDIA_FULL, false)]
    assert.equal((await tv.getStatus(true)).online, false)
    await assert.rejects(() => tv.sendKey('KEY_MUTE'), (e: { code?: string; message: string }) => e.code === 'offline' && /выключен/.test(e.message))
    assert.equal(sent.length, 0)
    assert.equal(cfg.config.tv.sceneOn, 'scene.tv_on') // сцену запускает страница
  })
  it('HA не ответил: понятная ошибка, статус серый', async () => {
    haFail = new Error('connect ECONNREFUSED 127.0.0.1:8123')
    await assert.rejects(() => tv.sendKey('KEY_MUTE'), (e: { code?: string; message: string }) => e.code === 'offline' && /Home Assistant/.test(e.message))
    const s = await tv.getStatus(true)
    assert.equal(s.online, false)
    assert.deepEqual(s.keys, [])
  })
  it('не больше 5 ключей в секунду', async () => {
    let ok = 0
    let limited = 0
    for (let i = 0; i < 9; i++) await tv.sendKey('KEY_UP').then(() => ok++, (e: { code?: string }) => e.code === 'rate' && limited++)
    assert.equal(ok, 5)
    assert.equal(limited, 4)
    assert.equal(sent.length, 5)
  })
  it('сопряжение в этом режиме не нужно и ничего не делает', async () => {
    await assert.rejects(() => tv.pair(), (e: { code?: string; message: string }) => e.code === 'bad' && /сопряжение не нужно/.test(e.message))
    assert.equal(socks.length, 0)
  })
  it('в статусе и в ответе нет токена', async () => {
    const r = await tv.sendKey('KEY_MUTE')
    const json = JSON.stringify({ status: await tv.getStatus(true), key: r, sent })
    assert.ok(!json.includes('подставной-токен'))
    assert.ok(!/"token"/i.test(json)) // tokenAuth (нужен ли ТВ токен) — не секрет, самого токена нет
  })
  it('переключение обратно в прямой режим ничего не ломает', async () => {
    tv.setDriver('direct')
    tv.resetStatus()
    await pairNow()
    socks.length = 0
    await tv.sendKey('KEY_MUTE')
    assert.equal(sent.length, 0)
    assert.equal(socks.length, 1)
    assert.match((await tv.getStatus(true)).driver, /direct/)
  })
})
