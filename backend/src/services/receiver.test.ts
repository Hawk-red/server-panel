// Тесты пульта ресивера на подставном сокете и подставном веб-интерфейсе: разбор ответов, белый список, потолок громкости,
// ограничение частоты, общий сеанс (закрывается по простою), refused, подтверждение команд. Реальный ресивер не трогается.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { config } from '../config.js'
import * as r from './receiver.js'

type Fake = EventEmitter & { written: string[]; destroyed: boolean; write(d: string): boolean; destroy(): void }

class Device {
  pw = 'ON'
  mv = 40
  mu = 'OFF'
  si = 'BD'
  ms = 'STEREO'
  dynEq = 'ON'
  dynVol = 'MED'
  refLev = '0'
  tone = 'OFF'
  multEq = 'AUDYSSEY'
  name = 'ANDROID' // имя входа в XML
  ignore = new Set<string>() // команды, на которые ресивер «не реагирует»
  quickEcho = true
  socks: Fake[] = []
  active = 0
  maxActive = 0
  all = () => this.socks.flatMap((s) => s.written)
  mvLine = () => `MV${this.mv % 1 ? Math.round(this.mv * 10) : this.mv}`

  reply(cmd: string): string {
    switch (cmd) {
      case 'PW?': return `PW${this.pw}\r@PWR:2\r`
      case 'MV?': return `${this.mvLine()}\r@VOL:-400\rMVMAX 935\r`
      case 'MU?': return `MU${this.mu}\r@AMT:1\r`
      case 'SI?': return `SI${this.si}\r@SRC:MM\rPSMDAX OFF\rSVOFF\r`
      case 'MS?': return `MS${this.ms}\rPSDRC OFF\rPSBAS 50\rPSTONE CTRL ${this.tone}\r`
      case 'PSDYNEQ ?': return `PSDYNEQ ${this.dynEq}\r@ADE:2\r`
      case 'PSDYNVOL ?': return `PSDYNVOL ${this.dynVol}\r`
      case 'PSREFLEV ?': return `PSREFLEV ${this.refLev}\r`
      case 'PSTONE CTRL ?': return `PSTONE CTRL ${this.tone}\r`
      case 'PSMULTEQ: ?': return `PSMULTEQ:${this.multEq}\r`
    }
    if (this.ignore.has(cmd)) return ''
    if (cmd === 'PWON' || cmd === 'PWSTANDBY') { this.pw = cmd.slice(2); return `${cmd}\r` }
    if (cmd === 'MVUP') { this.mv += 0.5; return `${this.mvLine()}\r` }
    if (cmd === 'MVDOWN') { this.mv -= 0.5; return `${this.mvLine()}\r` }
    if (cmd === 'MUON' || cmd === 'MUOFF') { this.mu = cmd.slice(2); return `${cmd}\r` }
    if (cmd === 'MSMOVIE') { this.ms = 'DOLBY DIGITAL'; return 'MSDOLBY DIGITAL\r' }
    if (cmd.startsWith('MS') && !cmd.startsWith('MSQUICK')) { this.ms = cmd.slice(2); return `${cmd}\r` }
    if (cmd.startsWith('MSQUICK')) return this.quickEcho ? `${cmd}\r` : ''
    if (cmd.startsWith('SI')) { this.si = cmd.slice(2); return `${cmd}\r` }
    if (cmd === 'PSDYNEQ ON' || cmd === 'PSDYNEQ OFF') { this.dynEq = cmd.slice(8); return `${cmd}\r` }
    if (cmd.startsWith('PSDYNVOL ')) { this.dynVol = cmd.slice(9); return `${cmd}\r` }
    return ''
  }
  connector(): r.Connector {
    return async () => {
      const dev = this
      const s = new EventEmitter() as Fake
      s.written = []
      s.destroyed = false
      this.active++
      this.maxActive = Math.max(this.maxActive, this.active)
      s.write = (d: string) => {
        const cmd = d.replace(/\r$/, '')
        s.written.push(cmd)
        const rep = dev.reply(cmd)
        if (rep && !s.destroyed) setTimeout(() => s.emit('data', Buffer.from(rep)), 1)
        return true
      }
      s.destroy = () => {
        if (!s.destroyed) { dev.active--; s.emit('close') }
        s.destroyed = true
      }
      this.socks.push(s)
      return s as never
    }
  }
}

const RENAME = `<INPUT type='text' name='textFuncRenameSATCBL' value="CBL/SAT" size='20'>
<INPUT type='text' name='textFuncRenameBD' value="Blu-ray" size='20'>
<INPUT type='text' name='textFuncRenameGAME' value="GAME" size='20'>
<INPUT type='text' name='textFuncRenameAUX1' value="MacMini" size='20'>
<INPUT type='text' name='textFuncRenameMPLAY' value="ANDROID" size='20'>
<INPUT type='text' name='textFuncRenameTV' value="PS4 & TV" size='20'>
<INPUT type='text' name='textFuncRenameMXPORT' value="M-XPort" size='20'>`
const HIDE = `<INPUT type='radio' name='TUNER' value='USE' onClick='radioBtn()' checked>
<INPUT type='radio' name='TUNER' value='DEL' onClick='radioBtn()'>
<INPUT type='radio' name='BD' value='USE' onClick='radioBtn()'>
<INPUT type='radio' name='BD' value='DEL' onClick='radioBtn()' checked>
<INPUT type='radio' name='GAME' value='USE' onClick='radioBtn()' checked>`

let dev: Device
const realFetch = globalThis.fetch
let hideBd = false

beforeEach(() => {
  dev = new Device()
  r.setConnector(dev.connector())
  r.closeSession()
  r.resetInputsCache()
  r.resetRate()
  hideBd = false
  config.marantz.maxVolume = 60
  Object.assign(r.timing, { connectMs: 200, replyMs: 40, settleMs: 15, powerMs: 40, quietMs: 1, gapWriteMs: 0, gapSessionMs: 1, idleMs: 8000, cacheMs: 5000, inputsCacheMs: 60_000, rateWindowMs: 1000, rateMax: 4 })
  globalThis.fetch = (async (url: string) => {
    const u = String(url)
    const body = u.includes('SOURCERENAME') ? RENAME : u.includes('HIDESOURCES') ? (hideBd ? HIDE : HIDE.replace("name='BD' value='DEL' onClick='radioBtn()' checked", "name='BD' value='DEL' onClick='radioBtn()'")) : u.includes('MainZoneXml') ? `<item><InputFuncSelect><value>${dev.name.replace('&', '&amp;')}</value></InputFuncSelect></item>` : ''
    return new Response(body, { status: 200 })
  }) as never
})
afterEach(() => {
  r.closeSession()
  globalThis.fetch = realFetch
})

describe('разбор', () => {
  it('parseLines выбрасывает служебные строки @…', () => {
    assert.deepEqual(r.parseLines('PSDYNEQ ON\r@ADE:2\r\r'), ['PSDYNEQ ON'])
  })
  it('parseVolume: MV40 → 40, MV455 → 45,5, MVMAX и мусор → null', () => {
    assert.equal(r.parseVolume('MV40'), 40)
    assert.equal(r.parseVolume('MV455'), 45.5)
    assert.equal(r.parseVolume('MVMAX 935'), null)
    assert.equal(r.parseVolume(null), null)
  })
  it('parseInputs: имена из переименования, скрытые и M-XPort исключены, SATCBL → SAT/CBL', () => {
    const list = r.parseInputs(RENAME, HIDE)
    assert.deepEqual(list.map((i) => i.code), ['SAT/CBL', 'GAME', 'AUX1', 'MPLAY', 'TV', 'TUNER'])
    assert.equal(list.find((i) => i.code === 'TV')?.name, 'PS4 & TV')
    assert.equal(list.find((i) => i.code === 'MPLAY')?.name, 'ANDROID')
  })
})

describe('белый список', () => {
  it('допускает ровно разрешённые команды', () => {
    for (const c of ['PWON', 'PWSTANDBY', 'MVUP', 'MVDOWN', 'MUON', 'MUOFF', 'MNCUP', 'MNCDN', 'MNCLT', 'MNCRT', 'MNENT', 'MNRTN', 'MNMEN ON', 'MNMEN OFF', 'MNINF', 'MNOPT', 'MSQUICK1', 'MSQUICK2', 'MSQUICK3', 'MSMOVIE', 'MSMUSIC', 'MSGAME', 'MSDIRECT', 'MSPURE DIRECT', 'MSSTEREO', 'SIBD', 'SISAT/CBL', 'SITV']) {
      assert.doesNotThrow(() => r.classify(c), c)
    }
  })
  it('отклоняет всё остальное (MV<число>, PWRESET и т. п.) без открытия сокета', async () => {
    for (const c of ['MV45', 'MV455', 'MV80', 'MVMAX', 'MV?', 'PWRESET', 'PW', 'PWON ', 'pwon', 'MSQUICK4', 'MSQUICK5', 'SIFOO', 'SI', 'MNMEN', 'MUTE', 'PWSTANDBY\rMV80', 'PSDYNEQ ON', 'PSRSTR', 'MNRST', 'CVFL UP', '', 'SI BD', 'SIBD\rMV99']) {
      await assert.rejects(() => r.sendCommand(c), (e: r.ReceiverError) => e.code === 'bad', JSON.stringify(c))
    }
    assert.equal(dev.socks.length, 0)
  })
  it('вход допускается только из списка самого ресивера (скрытый BD — нет)', async () => {
    hideBd = true
    await assert.rejects(() => r.sendCommand('SIBD'), (e: r.ReceiverError) => e.code === 'bad')
    assert.equal(dev.socks.length, 0)
  })
  it('звук: чужие параметры и значения отклоняются', async () => {
    for (const [k, v] of [['dynEq', 'MAYBE'], ['dynVol', 'ON'], ['refLev', '7'], ['tone', '1'], ['power', 'OFF'], ['volume', '50'], ['multEq', 'FLAT'], ['__proto__', 'ON'], ['constructor', 'ON']]) {
      await assert.rejects(() => r.setValue(k, v), (e: r.ReceiverError) => e.code === 'bad')
    }
    assert.equal(dev.socks.length, 0)
  })
})

describe('состояние', () => {
  it('читает всё одним соединением, шлёт только запросы, имя входа — из XML ресивера', async () => {
    const st = await r.getState(true)
    assert.equal(st.power, 'ON')
    assert.equal(st.volume, 40)
    assert.equal(st.volumeDb, -40)
    assert.equal(st.maxVolume, 60)
    assert.equal(st.mute, false)
    assert.deepEqual(st.input, { code: 'BD', name: 'ANDROID' })
    assert.equal(st.mode, 'STEREO')
    assert.equal(st.dynEq, 'ON')
    assert.equal(st.dynVol, 'MED')
    assert.equal(st.refLev, '0')
    assert.equal(st.tone, 'OFF')
    assert.equal(st.multEq, 'AUDYSSEY')
    assert.ok(st.inputs.length > 0)
    assert.equal(dev.socks.length, 1)
    assert.ok(dev.all().every((c) => c.endsWith('?')))
  })
  it('кэш 5 с: второй вызов без обращения к ресиверу', async () => {
    await r.getState(true)
    const n = dev.all().length
    await r.getState()
    assert.equal(dev.all().length, n)
  })
  it('в режиме ожидания остальные запросы не шлются', async () => {
    dev.pw = 'STANDBY'
    const st = await r.getState(true)
    assert.equal(st.power, 'STANDBY')
    assert.equal(st.volume, null)
    assert.deepEqual(dev.socks[0].written, ['PW?'])
  })
  it('быстрое чтение: без пауз 300 мс внутри сеанса', async () => {
    const t = Date.now()
    await r.getState(true)
    assert.ok(Date.now() - t < 600, `заняло ${Date.now() - t} мс`)
  })
})

describe('общий сеанс', () => {
  it('одно соединение переиспользуется и закрывается по простою', async () => {
    r.timing.idleMs = 60
    await r.getState(true)
    await r.sendCommand('MNCUP')
    await r.getState(true)
    assert.equal(dev.socks.length, 1)
    assert.equal(dev.socks[0].destroyed, false)
    await new Promise((res) => setTimeout(res, 120))
    assert.equal(dev.socks[0].destroyed, true)
    await r.getState(true)
    assert.equal(dev.socks.length, 2) // новое соединение после простоя
  })
  it('параллельные запросы идут по одному, соединение максимум одно', async () => {
    await Promise.all([r.getState(true), r.getState(true), r.sendCommand('MNCUP'), r.sendCommand('MNCDN')])
    assert.equal(dev.maxActive, 1)
  })
  it('Connection refused → busy, без повторов', async () => {
    let calls = 0
    r.setConnector(async () => {
      calls++
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    })
    await assert.rejects(() => r.getState(true), (e: r.ReceiverError) => e.code === 'busy' && /занят/.test(e.message))
    assert.equal(calls, 1)
  })
  it('ошибка сокета посреди сеанса: соединение закрыто, следующий запрос открывает новое', async () => {
    const bad = dev.connector()
    let first = true
    r.setConnector(async () => {
      const s = (await bad()) as unknown as Fake
      if (first) {
        first = false
        s.write = () => {
          setTimeout(() => s.emit('error', Object.assign(new Error('x'), { code: 'ECONNRESET' })), 1)
          return true
        }
      }
      return s as never
    })
    await assert.rejects(() => r.getState(true), (e: r.ReceiverError) => e instanceof r.ReceiverError)
    assert.ok(dev.socks[0].destroyed)
    await r.getState(true)
    assert.equal(dev.socks.length, 2)
  })
})

describe('громкость', () => {
  it('MVUP при значении на потолке отклоняется (409/limit), команда не уходит', async () => {
    dev.mv = 60
    await assert.rejects(() => r.sendCommand('MVUP'), (e: r.ReceiverError) => e.code === 'limit' && /потолок/.test(e.message))
    assert.ok(!dev.all().includes('MVUP'))
    dev.mv = 61
    await assert.rejects(() => r.sendCommand('MVUP'), (e: r.ReceiverError) => e.code === 'limit')
  })
  it('MVUP ниже потолка проходит; значение берётся из свежего MV?, не из кэша', async () => {
    dev.mv = 40
    await r.getState(true) // кэш: 40
    dev.mv = 60 // за спиной панели подняли до потолка
    await assert.rejects(() => r.sendCommand('MVUP'), (e: r.ReceiverError) => e.code === 'limit')
    dev.mv = 59.5
    const res = await r.sendCommand('MVUP')
    assert.equal(res.volume, 60)
    assert.ok(dev.all().includes('MVUP'))
  })
  it('потолок берётся из config.marantz.maxVolume', async () => {
    config.marantz.maxVolume = 30
    await assert.rejects(() => r.sendCommand('MVUP'), (e: r.ReceiverError) => e.code === 'limit')
  })
  it('MVDOWN работает и выше потолка', async () => {
    dev.mv = 70
    const res = await r.sendCommand('MVDOWN')
    assert.equal(res.volume, 69.5)
  })
  it('громкость и навигация: не чаще 4 команд в секунду суммарно', async () => {
    let ok = 0
    let limited = 0
    for (let i = 0; i < 12; i++) {
      await r.sendCommand(i % 2 ? 'MNCUP' : 'MVDOWN').then(() => ok++, (e: r.ReceiverError) => e.code === 'rate' && limited++)
    }
    assert.equal(ok, 4)
    assert.equal(limited, 8)
    const sent = dev.all().filter((c) => c === 'MNCUP' || c === 'MVDOWN')
    assert.equal(sent.length, 4)
  })
  it('частота восстанавливается через окно', async () => {
    r.timing.rateWindowMs = 30
    for (let i = 0; i < 4; i++) await r.sendCommand('MNCUP')
    await assert.rejects(() => r.sendCommand('MNCUP'), (e: r.ReceiverError) => e.code === 'rate')
    await new Promise((res) => setTimeout(res, 40))
    await r.sendCommand('MNCUP')
  })
})

describe('команды с подтверждением', () => {
  it('питание: PWSTANDBY принят, состояние перечитано', async () => {
    const res = await r.sendCommand('PWSTANDBY')
    assert.equal(res.accepted, true)
    assert.equal(res.after, 'STANDBY')
    assert.equal(res.state?.power, 'STANDBY')
  })
  it('питание: ресивер не отреагировал → «не принял команду»', async () => {
    dev.ignore.add('PWSTANDBY')
    const res = await r.sendCommand('PWSTANDBY')
    assert.equal(res.accepted, false)
    assert.equal(res.message, 'Ресивер не принял команду PWSTANDBY')
    assert.equal(res.state?.power, 'ON') // интерфейс показывает реальное состояние
  })
  it('PWON из режима ожидания', async () => {
    dev.pw = 'STANDBY'
    const res = await r.sendCommand('PWON')
    assert.equal(res.accepted, true)
    assert.equal(res.state?.power, 'ON')
  })
  it('mute: принят и не принят', async () => {
    assert.equal((await r.sendCommand('MUON')).accepted, true)
    assert.equal(dev.mu, 'ON')
    dev.ignore.add('MUOFF')
    const res = await r.sendCommand('MUOFF')
    assert.equal(res.accepted, false)
    assert.equal(res.state?.mute, true)
  })
  it('режим: Movie → «DOLBY DIGITAL» считается принятым (режим изменился)', async () => {
    const res = await r.sendCommand('MSMOVIE')
    assert.equal(res.accepted, true)
    assert.equal(res.state?.mode, 'DOLBY DIGITAL')
  })
  it('режим: игнорируется → не принят', async () => {
    dev.ignore.add('MSMUSIC')
    const res = await r.sendCommand('MSMUSIC')
    assert.equal(res.accepted, false)
    assert.match(res.message ?? '', /MSMUSIC/)
  })
  it('вход: подтверждение по коду SI? и по имени из XML', async () => {
    const res = await r.sendCommand('SIGAME')
    assert.equal(res.accepted, true)
    assert.equal(res.state?.input?.code, 'GAME')
    // ресивер ответил другим кодом, но имя входа в XML совпало с плиткой (SIBD ↔ «ANDROID»)
    dev.ignore.add('SIMPLAY')
    dev.si = 'BD'
    dev.name = 'ANDROID'
    const res2 = await r.sendCommand('SIMPLAY')
    assert.equal(res2.accepted, true)
  })
  it('вход: ресивер не отреагировал → не принят', async () => {
    dev.ignore.add('SIGAME')
    const res = await r.sendCommand('SIGAME')
    assert.equal(res.accepted, false)
    assert.equal(res.message, 'Ресивер не принял команду SIGAME')
  })
  it('Quick Select: принят, если ресивер ответил; иначе «не принял»', async () => {
    assert.equal((await r.sendCommand('MSQUICK2')).accepted, true)
    dev.quickEcho = false
    const res = await r.sendCommand('MSQUICK3')
    assert.equal(res.accepted, false)
    assert.match(res.message ?? '', /MSQUICK3/)
  })
  it('в режиме ожидания команды режима/входа/mute не уходят', async () => {
    dev.pw = 'STANDBY'
    for (const c of ['MSMOVIE', 'SIGAME', 'MUON']) await assert.rejects(() => r.sendCommand(c), (e: r.ReceiverError) => e.code === 'standby')
    assert.ok(!dev.all().some((c) => c === 'MSMOVIE' || c === 'SIGAME' || c === 'MUON'))
  })
  it('состояние после серии кликов: громкость вверх-вниз и mute', async () => {
    dev.mv = 40
    for (const c of ['MVUP', 'MVUP', 'MVDOWN']) {
      await r.sendCommand(c)
      await new Promise((res) => setTimeout(res, 1))
    }
    await r.sendCommand('MUON')
    const st = await r.getState(true)
    assert.equal(st.volume, 40.5)
    assert.equal(st.mute, true)
  })
  it('метрики: считаются принятые, не принятые, частота', async () => {
    const before = r.getStats()
    dev.ignore.add('MSMUSIC')
    await r.sendCommand('MSMUSIC')
    await r.sendCommand('MNCUP')
    const s = r.getStats()
    assert.equal(s.notAccepted, before.notAccepted + 1)
  })
})

describe('звук (переключатели)', () => {
  it('запись: PW? → до → команда → после; отдаёт реальное значение', async () => {
    dev.ignore.add('PSDYNVOL HEV')
    const res = await r.setValue('dynVol', 'HEV')
    assert.equal(res.command, 'PSDYNVOL HEV')
    assert.equal(res.before, 'MED')
    assert.equal(res.after, 'MED') // ресивер не принял — возвращается реальное
    assert.deepEqual(dev.socks[0].written.slice(0, 4), ['PW?', 'PSDYNVOL ?', 'PSDYNVOL HEV', 'PSDYNVOL ?'])
  })
  it('при выключенном ресивере запись не уходит', async () => {
    dev.pw = 'STANDBY'
    await assert.rejects(() => r.setValue('dynEq', 'OFF'), (e: r.ReceiverError) => e.code === 'standby')
    assert.deepEqual(dev.socks[0].written, ['PW?'])
  })
})
