// Тесты маршрута абсолютной громкости (POST /api/receiver/volume) на подставном ресивере: коды ответов (400 для мусора,
// 409 без связи, 429 при частоте), фактическое значение в ответе, одна запись в журнале на серию и выбор скина.
// Настоящий ресивер не трогается: telnet подменён.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'sp-volume-'))

const { default: Fastify } = await import('fastify')
const { default: cookie } = await import('@fastify/cookie')
const { db } = await import('../db.js')
const { config } = await import('../config.js')
const { serviceRoutes } = await import('./services.js')
const { SESSION_COOKIE } = await import('../auth.js')
const receiver = await import('../services/receiver.js')
const { flushVolumeSeries, volumeLog } = await import('../services/volumeLog.js')
const { getSetting, setSetting } = await import('../settings.js')

type Fake = EventEmitter & { written: string[]; destroyed: boolean; write(d: string): boolean; destroy(): void }
const dev = { pw: 'ON', mv: 40 as number | null, socks: [] as Fake[] }
const line = () => (dev.mv === null ? '' : `MV${dev.mv % 1 ? Math.round(dev.mv * 10) : dev.mv}\r`)
receiver.setConnector(async () => {
  const s = new EventEmitter() as Fake
  s.written = []
  s.destroyed = false
  s.write = (d: string) => {
    const cmd = d.replace(/\r$/, '')
    s.written.push(cmd)
    let rep = ''
    if (cmd === 'PW?') rep = `PW${dev.pw}\r`
    else if (cmd === 'MV?') rep = dev.pw === 'ON' ? line() : ''
    else {
      const m = /^MV(\d{2,3})$/.exec(cmd)
      if (m && dev.pw === 'ON') {
        dev.mv = m[1].length === 3 ? Number(m[1]) / 10 : Number(m[1])
        rep = line()
      }
    }
    if (rep && !s.destroyed) setTimeout(() => s.emit('data', Buffer.from(rep)), 1)
    return true
  }
  s.destroy = () => {
    if (!s.destroyed) s.emit('close')
    s.destroyed = true
  }
  dev.socks.push(s)
  return s as never
})
config.marantz.maxVolume = 60
Object.assign(receiver.timing, { connectMs: 200, replyMs: 40, settleMs: 15, quietMs: 1, gapWriteMs: 0, gapSessionMs: 1 })
Object.assign(receiver.volumeTiming, { stepGapMs: 2, knownMs: 2000, rateWindowMs: 1000, rateMax: 12 })
volumeLog.seriesMs = 60_000 // серию в тестах закрываем вручную

const app = Fastify()
await app.register(cookie)
app.decorateRequest('clientIp', '')
app.addHook('onRequest', async (req) => void (req.clientIp = '127.0.0.1'))
await app.register(serviceRoutes)
const SID = 'test-session'
const now = Date.now()
db.prepare('INSERT INTO sessions (id_hash, created_at, expires_at, last_seen, ip, user_agent, source, second_factor) VALUES (?,?,?,?,?,?,?,?)').run(
  createHash('sha256').update(SID).digest('hex'), now, now + 3_600_000, now, '127.0.0.1', 't', 'external', 1,
)
after(() => {
  receiver.closeSession()
  flushVolumeSeries()
  return app.close()
})

const post = (value: unknown) => app.inject({ method: 'POST', url: '/api/receiver/volume', cookies: { [SESSION_COOKIE]: SID }, payload: { value } })
const volumeRows = () => db.prepare(`SELECT target, details FROM audit_log WHERE action = 'receiver.volume' ORDER BY id`).all() as { target: string; details: string }[]
const reset = (mv: number | null = 40) => {
  dev.pw = 'ON'
  dev.mv = mv
  receiver.resetVolume()
  receiver.closeSession()
}

describe('POST /api/receiver/volume', () => {
  it('без входа — 401', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/receiver/volume', payload: { value: 40 } })
    assert.equal(r.statusCode, 401)
  })
  it('значение вне шкалы или не число — 400 (bad)', async () => {
    reset()
    for (const v of [-1, 99, '40', null, true, {}, [], NaN]) {
      const r = await post(v)
      assert.equal(r.statusCode, 400, JSON.stringify(v))
      assert.equal(JSON.parse(r.body).code, 'bad')
    }
  })
  it('обычное изменение: в ответе фактическое значение и потолок', async () => {
    reset()
    const r = await post(45)
    assert.equal(r.statusCode, 200)
    assert.deepEqual(JSON.parse(r.body), { from: 40, volume: 45, target: 45, clamped: false, maxVolume: 60 })
  })
  it('выше потолка — обрезка до потолка, 200 (не ошибка)', async () => {
    reset()
    const r = await post(90)
    const j = JSON.parse(r.body)
    assert.equal(r.statusCode, 200)
    assert.equal(j.volume, 60)
    assert.equal(j.clamped, true)
  })
  it('ресивер выключен — 409', async () => {
    reset()
    dev.pw = 'STANDBY'
    const r = await post(40)
    assert.equal(r.statusCode, 409)
    assert.equal(JSON.parse(r.body).code, 'standby')
    assert.match(JSON.parse(r.body).message, /выключен/)
  })
  it('слишком часто — 429', async () => {
    reset()
    await new Promise((res) => setTimeout(res, 1100)) // свежее окно лимита
    for (let i = 0; i < 12; i++) assert.equal((await post(40 - i * 0.5)).statusCode, 200)
    const r = await post(30)
    assert.equal(r.statusCode, 429)
    assert.equal(JSON.parse(r.body).code, 'rate')
  })
  it('журнал: одна запись на серию протяжки, от первого значения до последнего', async () => {
    db.prepare(`DELETE FROM audit_log`).run()
    reset(40)
    await new Promise((res) => setTimeout(res, 1100))
    for (const v of [41, 42, 43, 44, 45]) assert.equal((await post(v)).statusCode, 200)
    assert.deepEqual(volumeRows(), []) // пока серия не закрыта — записей нет
    flushVolumeSeries()
    const rows = volumeRows()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].target, '−40,0 dB → −35,0 dB')
    assert.match(JSON.parse(rows[0].details).message, /громкость изменена: от −40,0 dB до −35,0 dB/)
    // следующая протяжка — своя запись
    await new Promise((res) => setTimeout(res, 1100))
    for (const v of [44, 43]) assert.equal((await post(v)).statusCode, 200)
    flushVolumeSeries()
    assert.equal(volumeRows().length, 2)
    assert.equal(volumeRows()[1].target, '−35,0 dB → −37,0 dB')
  })
})

describe('скин регулятора', () => {
  const get = () => app.inject({ method: 'GET', url: '/api/receiver/volume/skin', cookies: { [SESSION_COOKIE]: SID } })
  const put = (skin: unknown) => app.inject({ method: 'PUT', url: '/api/receiver/volume/skin', cookies: { [SESSION_COOKIE]: SID }, payload: { skin } })
  it('по умолчанию «Крутилка», сохраняется в настройке receiver.volumeSkin', async () => {
    assert.deepEqual(JSON.parse((await get()).body), { skin: 'knob', skins: ['knob', 'mixer', 'capsule'] })
    assert.equal((await put('capsule')).statusCode, 200)
    assert.equal(JSON.parse((await get()).body).skin, 'capsule')
    assert.equal(getSetting('receiver.volumeSkin', 'knob'), 'capsule')
  })
  it('неизвестный и прежний скин — 400, настройка не меняется', async () => {
    for (const v of ['neon', '', 42, null, {}, 'fader', 'bar', 'led', 'dial']) assert.equal((await put(v)).statusCode, 400, JSON.stringify(v))
    assert.equal(JSON.parse((await get()).body).skin, 'capsule')
  })
  it('сохранённый прежний вид откатывается на «Крутилку»', async () => {
    for (const old of ['fader', 'bar', 'led', 'dial']) {
      setSetting('receiver.volumeSkin', old)
      assert.equal(JSON.parse((await get()).body).skin, 'knob', old)
    }
    assert.equal((await put('mixer')).statusCode, 200)
    assert.equal(getSetting('receiver.volumeSkin', 'knob'), 'mixer')
  })
})
