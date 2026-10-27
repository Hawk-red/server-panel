// Тесты абсолютной громкости (регулятор-протяжка) на подставном сокете: потолок, ограничение роста, догон шагами,
// половинные шаги, коалесинг «только последнее значение», отказ без связи, лимит частоты, проверка значения и один сеанс.
// Реальный ресивер не трогается: MV<число> уходит только в подставное устройство.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { config } from '../config.js'
import * as r from './receiver.js'

type Fake = EventEmitter & { written: string[]; destroyed: boolean; write(d: string): boolean; destroy(): void }

/** Ресивер: отвечает на PW?/MV? и принимает MV<число> (в т. ч. половинный MV455), отражая новое значение */
class Device {
  pw = 'ON'
  mv: number | null = 40
  silent = false // MV? молчит (ресивер ещё не готов)
  echo = true // подтверждает ли MV<число> строкой MV…
  socks: Fake[] = []
  refuse = false
  all = () => this.socks.flatMap((s) => s.written)
  mvCmds = () => this.all().filter((c) => /^MV\d{2,3}$/.test(c))
  line = () => (this.mv === null ? '' : `MV${this.mv % 1 ? Math.round(this.mv * 10) : this.mv}\r@VOL:-400\r`)

  reply(cmd: string): string {
    if (cmd === 'PW?') return `PW${this.pw}\r`
    if (cmd === 'MV?') return this.silent || this.pw !== 'ON' ? '' : this.line()
    const m = /^MV(\d{2,3})$/.exec(cmd)
    if (m) {
      if (this.pw !== 'ON') return ''
      this.mv = m[1].length === 3 ? Number(m[1]) / 10 : Number(m[1])
      return this.echo ? this.line() : ''
    }
    return ''
  }
  connector(): r.Connector {
    return async () => {
      if (this.refuse) throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })
      const dev = this
      const s = new EventEmitter() as Fake
      s.written = []
      s.destroyed = false
      s.write = (d: string) => {
        const cmd = d.replace(/\r$/, '')
        s.written.push(cmd)
        const rep = dev.reply(cmd)
        if (rep && !s.destroyed) setTimeout(() => s.emit('data', Buffer.from(rep)), 1)
        return true
      }
      s.destroy = () => {
        if (!s.destroyed) s.emit('close')
        s.destroyed = true
      }
      this.socks.push(s)
      return s as never
    }
  }
}

let dev: Device

beforeEach(() => {
  dev = new Device()
  r.setConnector(dev.connector())
  r.closeSession()
  r.resetVolume()
  config.marantz.maxVolume = 60
  Object.assign(r.timing, { connectMs: 200, replyMs: 40, settleMs: 15, powerMs: 40, quietMs: 1, gapWriteMs: 0, gapSessionMs: 1, idleMs: 8000, cacheMs: 5000 })
  Object.assign(r.volumeTiming, { stepGapMs: 2, knownMs: 2000, rateWindowMs: 1000, rateMax: 12 })
})
afterEach(() => {
  r.closeSession()
  r.resetVolume()
})

describe('громкость: значение и команда', () => {
  it('MV-команда: 45 → MV45, 45,5 → MV455, 0 → MV00, 5 → MV05', () => {
    assert.equal(r.volumeCommand(45), 'MV45')
    assert.equal(r.volumeCommand(45.5), 'MV455')
    assert.equal(r.volumeCommand(0), 'MV00')
    assert.equal(r.volumeCommand(5), 'MV05')
    assert.equal(r.volumeCommand(45.3), 'MV455') // округление до половины шага
  })
  it('обрезка: выше потолка — потолок, ниже нуля — 0', () => {
    assert.equal(r.clampVolume(99), 60)
    assert.equal(r.clampVolume(-5), 0)
    assert.equal(r.clampVolume(40.26), 40.5)
  })
  it('значение вне шкалы или не число — отказ 400 (bad), сокет не открывается', async () => {
    for (const v of [-1, 99, 98.5, NaN, Infinity, '40', null, undefined, {}, [], '40.5', true]) {
      await assert.rejects(
        () => r.setVolume(v as unknown),
        (e: r.ReceiverError) => e.code === 'bad',
        JSON.stringify(v ?? String(v)),
      )
    }
    assert.equal(dev.socks.length, 0)
  })
})

describe('громкость: потолок и ограничение роста', () => {
  it('цель выше потолка обрезается до потолка, выше него не уходит ни одна команда', async () => {
    const res = await r.setVolume(95)
    assert.equal(res.target, 60)
    assert.equal(res.clamped, true)
    assert.equal(res.volume, 60)
    assert.equal(res.maxVolume, 60)
    assert.ok(dev.mvCmds().every((c) => r.parseVolume(c)! <= 60))
    assert.equal(dev.mv, 60)
  })
  it('за одну команду рост не больше +3: до цели сервер идёт шагами сам', async () => {
    const res = await r.setVolume(50)
    assert.deepEqual(dev.mvCmds(), ['MV43', 'MV46', 'MV49', 'MV50'])
    assert.equal(res.from, 40)
    assert.equal(res.volume, 50)
  })
  it('вниз — без ограничения: одна команда', async () => {
    const res = await r.setVolume(10)
    assert.deepEqual(dev.mvCmds(), ['MV10'])
    assert.equal(res.volume, 10)
  })
  it('потолок берётся из config.marantz.maxVolume', async () => {
    config.marantz.maxVolume = 42
    const res = await r.setVolume(60)
    assert.equal(res.volume, 42)
    assert.equal(res.target, 42)
    assert.deepEqual(dev.mvCmds(), ['MV42'])
  })
  it('половинный шаг проходит и возвращается как 40,5', async () => {
    const res = await r.setVolume(40.5)
    assert.deepEqual(dev.mvCmds(), ['MV405'])
    assert.equal(res.volume, 40.5)
    assert.equal(r.lastKnownVolume(), 40.5)
  })
  it('ответ — фактическое значение ресивера, даже если он округлил по-своему', async () => {
    const res = await r.setVolume(39)
    dev.mv = 39
    assert.equal(res.volume, 39)
    assert.equal(res.from, 40)
  })
})

describe('громкость: коалесинг и лимит частоты', () => {
  it('несколько значений подряд: применяется последнее, очередь не копится', async () => {
    const [a, b, c] = await Promise.all([r.setVolume(55), r.setVolume(42), r.setVolume(41)])
    // первая цель успевает сделать один шаг (+3) и уступает место свежему значению
    assert.deepEqual(dev.mvCmds(), ['MV43', 'MV41'])
    assert.equal(a.volume, 43)
    assert.equal(b.volume, 41)
    assert.equal(c.volume, 41)
    assert.equal(dev.mv, 41)
  })
  it('серия протяжки идёт одним telnet-сеансом (лимит ресивера — 2 подключения)', async () => {
    for (const v of [41, 42, 43, 42, 41, 40]) await r.setVolume(v)
    assert.equal(dev.socks.length, 1)
  })
  it('не больше 12 изменений в секунду: следующее — 429 (rate)', async () => {
    for (let i = 0; i < 12; i++) await r.setVolume(40 - i * 0.5)
    await assert.rejects(() => r.setVolume(30), (e: r.ReceiverError) => e.code === 'rate' && /не больше 12/.test(e.message))
  })
  it('пока значение свежее, MV? перед шагом не спрашивается', async () => {
    await r.setVolume(41)
    const before = dev.all().filter((c) => c === 'MV?').length
    await r.setVolume(42)
    assert.equal(dev.all().filter((c) => c === 'MV?').length, before)
  })
})

describe('громкость: когда недоступна', () => {
  it('ресивер в режиме ожидания — 409 (standby), MV<число> не уходит', async () => {
    dev.pw = 'STANDBY'
    await assert.rejects(() => r.setVolume(40), (e: r.ReceiverError) => e.code === 'standby' && /выключен/.test(e.message))
    assert.deepEqual(dev.mvCmds(), [])
  })
  it('ресивер молчит на MV? — 409 (standby) с понятным текстом', async () => {
    dev.silent = true
    await assert.rejects(() => r.setVolume(40), (e: r.ReceiverError) => e.code === 'standby' && /регулятор недоступен/.test(e.message))
    assert.deepEqual(dev.mvCmds(), [])
  })
  it('нет связи (оба telnet-подключения заняты) — busy', async () => {
    dev.refuse = true
    await assert.rejects(() => r.setVolume(40), (e: r.ReceiverError) => e.code === 'busy')
  })
  it('ресивер не подтвердил значение — дальше спрашиваем MV? заново', async () => {
    dev.echo = false
    const res = await r.setVolume(42)
    assert.equal(res.volume, 42) // отправленное значение
    assert.equal(r.lastKnownVolume(), null)
    dev.echo = true
    const n = dev.all().filter((c) => c === 'MV?').length
    await r.setVolume(41)
    assert.equal(dev.all().filter((c) => c === 'MV?').length, n + 1)
  })
})
