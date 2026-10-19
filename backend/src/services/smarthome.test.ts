// Тесты «Умного дома»: валидация, защита от SSRF, проверка online/offline на подставных сокетах, кэш (20 с), схема БД. Устройства не трогаются.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import Database from 'better-sqlite3'
import {
  assertLocal, check, realImpl, createStatusCache, guardedLookup, isPrivateIp, probeFor, validateDevice, validHost, type Probe, type Status,
} from './smarthomeCore.js'
import { SMART_DEVICES_DDL } from './smarthomeSchema.js'

const ok = (o: Record<string, unknown>) => {
  const r = validateDevice({ name: 'Лампа', kind: 'ping', host: '192.168.31.50', ...o })
  assert.ok(r.ok, JSON.stringify(r))
  return r.ok ? r.value : null!
}
const bad = (o: Record<string, unknown>) => {
  const r = validateDevice({ name: 'Лампа', kind: 'ping', host: '192.168.31.50', ...o })
  assert.equal(r.ok, false, JSON.stringify(o))
  return r.ok ? null! : r
}

describe('валидация', () => {
  it('имя 1–60 символов', () => {
    assert.equal(bad({ name: '' }).field, 'name')
    assert.equal(bad({ name: '   ' }).field, 'name')
    assert.equal(bad({ name: 'я'.repeat(61) }).field, 'name')
    ok({ name: 'я'.repeat(60) })
    assert.equal(ok({ name: '  Лампа  ' }).name, 'Лампа')
  })
  it('host: только IP/имя без пробелов и shell-символов', () => {
    for (const h of ['a b', 'x;reboot', '$(id)', '1.2.3.4 && ls', 'a|b', 'a`b`', '-bad', 'ho st', 'a/b', "a'b"]) assert.equal(bad({ host: h }).field, 'host', h)
    for (const h of ['192.168.31.50', 'lamp.local', 'my-lamp', '::1', 'fd00::5']) ok({ host: h })
    assert.ok(validHost('homeassistant.local'))
  })
  it('порт 1–65535', () => {
    for (const p of [0, 65536, -1, 1.5, 'abc']) assert.equal(bad({ kind: 'tcp', port: p }).field, 'port', String(p))
    assert.equal(ok({ kind: 'tcp', port: 65535 }).port, 65535)
    assert.equal(ok({ kind: 'tcp', port: '8123' }).port, 8123)
  })
  it('url: только http/https, без логина', () => {
    for (const u of ['ftp://192.168.1.1', 'javascript:alert(1)', 'file:///etc/passwd', 'http://u:p@192.168.1.1/', 'не ссылка']) assert.equal(bad({ kind: 'link', url: u }).field, 'url', u)
    assert.equal(ok({ kind: 'link', url: 'http://192.168.31.50:8080/ui' }).url, 'http://192.168.31.50:8080/ui')
    ok({ kind: 'link', url: 'https://192.168.31.1' })
  })
  it('обязательные поля по типам', () => {
    assert.equal(bad({ kind: 'link', host: '192.168.1.5' }).field, 'url')
    assert.equal(bad({ kind: 'http', host: '' }).field, 'host')
    assert.equal(bad({ kind: 'tcp', host: '192.168.1.5' }).field, 'port')
    assert.equal(bad({ kind: 'ping', host: '' }).field, 'host')
    assert.equal(bad({ kind: 'unknown' }).field, 'kind')
    ok({ kind: 'homeassistant', host: '' })
  })
  it('значок и длины', () => {
    assert.equal(bad({ icon: 'bomb' }).field, 'icon')
    assert.equal(bad({ room: 'к'.repeat(41) }).field, 'room')
    assert.equal(ok({ icon: undefined }).icon, 'other')
    assert.equal(ok({ room: ' Кухня ' }).room, 'Кухня')
  })
})

describe('SSRF: только локальная сеть', () => {
  it('диапазоны', () => {
    for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.31.112', '127.0.0.1', '::1', 'fd12::1', '::ffff:192.168.1.5']) assert.ok(isPrivateIp(ip), ip)
    for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '169.254.169.254', '148.251.76.118', '93.127.114.54', '2606:4700::1111', '::ffff:8.8.8.8', 'abc', '0.0.0.0']) assert.equal(isPrivateIp(ip), false, ip)
  })
  it('assertLocal: публичный IP отклоняется, имя с публичным адресом — тоже, неразрешённое имя — нет', async () => {
    await assert.rejects(assertLocal('8.8.8.8'), /локальной сети/)
    await assertLocal('192.168.1.1')
    const pub = ((_h, _o, cb) => cb(null, [{ address: '1.1.1.1', family: 4 }])) as never
    const mixed = ((_h, _o, cb) => cb(null, [{ address: '192.168.1.5', family: 4 }, { address: '1.1.1.1', family: 4 }])) as never
    const priv = ((_h, _o, cb) => cb(null, [{ address: '192.168.1.5', family: 4 }])) as never
    const none = ((_h, _o, cb) => cb(Object.assign(new Error('x'), { code: 'ENOTFOUND' }), [])) as never
    await assert.rejects(assertLocal('evil.example.com', pub), /локальной сети/)
    await assert.rejects(assertLocal('evil.example.com', mixed), /локальной сети/)
    await assertLocal('lamp.local', priv)
    await assertLocal('lamp.local', none)
  })
  it('guardedLookup: соединение с публичным адресом невозможно (защита от подмены DNS)', async () => {
    const lookupOf = (addrs: { address: string; family: number }[]) => guardedLookup(((_h: string, _o: unknown, cb: (e: null, a: typeof addrs) => void) => cb(null, addrs)) as never)
    const run = (lk: ReturnType<typeof guardedLookup>, host: string) =>
      new Promise<{ err: Error | null; addr?: unknown }>((resolve) => (lk as unknown as (h: string, o: object, cb: (e: Error | null, a?: unknown) => void) => void)(host, {}, (err, addr) => resolve({ err, addr })))
    assert.match((await run(lookupOf([{ address: '8.8.8.8', family: 4 }]), 'x.example')).err!.message, /локальной сети/)
    assert.match((await run(lookupOf([]), '8.8.8.8')).err!.message, /локальной сети/)
    assert.equal((await run(lookupOf([{ address: '192.168.1.9', family: 4 }]), 'lamp.local')).addr, '192.168.1.9')
    assert.equal((await run(lookupOf([]), '10.1.2.3')).err, null)
  })
})

describe('реальные проверки не выходят за локальную сеть', () => {
  it('публичный IP отклоняется до соединения (tcp, http, ping)', async () => {
    await assert.rejects(realImpl.tcp('8.8.8.8', 53, 500), /локальной сети/)
    await assert.rejects(realImpl.http('http://8.8.8.8/', 500), /локальной сети/)
    await assert.rejects(realImpl.http('http://[2606:4700::1111]/', 500), /локальной сети/)
    await assert.rejects(realImpl.ping('1.1.1.1', 500), /локальной сети/)
    await assert.rejects(realImpl.tcp('169.254.169.254', 80, 500), /локальной сети/)
  })
})

describe('что проверять', () => {
  it('по типам', () => {
    assert.deepEqual(probeFor({ kind: 'ping', host: '192.168.1.5', port: null, url: null }), { method: 'ping', host: '192.168.1.5' })
    assert.deepEqual(probeFor({ kind: 'tcp', host: '192.168.1.5', port: 22, url: null }), { method: 'tcp', host: '192.168.1.5', port: 22 })
    assert.deepEqual(probeFor({ kind: 'http', host: '192.168.1.5', port: null, url: null }), { method: 'http', url: 'http://192.168.1.5:80/' })
    assert.deepEqual(probeFor({ kind: 'http', host: null, port: null, url: 'https://192.168.1.5/x' }), { method: 'http', url: 'https://192.168.1.5/x' })
    assert.deepEqual(probeFor({ kind: 'link', host: null, port: null, url: 'https://192.168.1.5/' }), { method: 'tcp', host: '192.168.1.5', port: 443 })
    assert.deepEqual(probeFor({ kind: 'homeassistant', host: '192.168.31.112', port: null, url: null }), { method: 'tcp', host: '192.168.31.112', port: 8123 })
    assert.equal(probeFor({ kind: 'homeassistant', host: null, port: null, url: null }), null)
  })
})

describe('проверка online/offline на моке', () => {
  const impl = (o: { tcp?: () => Promise<void>; http?: () => Promise<number>; ping?: () => Promise<void> }) => ({
    tcp: o.tcp ?? (async () => undefined), http: o.http ?? (async () => 200), ping: o.ping ?? (async () => undefined),
  })
  it('в сети: задержка считается', async () => {
    let t = 1000
    const s = await check({ method: 'tcp', host: '192.168.1.5', port: 80 }, impl({ tcp: async () => void (t += 12) }), () => t)
    assert.deepEqual([s.state, s.latencyMs, s.checkedAt], ['online', 12, 1012])
  })
  it('не в сети: причина, без задержки', async () => {
    const s = await check({ method: 'tcp', host: '192.168.1.5', port: 80 }, impl({ tcp: async () => { throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' }) } }))
    assert.deepEqual([s.state, s.latencyMs, s.detail], ['offline', null, 'ECONNREFUSED'])
  })
  it('http: любой ответ — в сети, код в подписи; таймаут — не в сети', async () => {
    const a = await check({ method: 'http', url: 'http://192.168.1.5/' }, impl({ http: async () => 401 }))
    assert.deepEqual([a.state, a.detail], ['online', 'HTTP 401'])
    const b = await check({ method: 'http', url: 'http://192.168.1.5/' }, impl({ http: async () => { throw new Error('таймаут') } }))
    assert.deepEqual([b.state, b.detail], ['offline', 'таймаут'])
  })
  it('публичный адрес даёт offline с понятной причиной', async () => {
    const s = await check({ method: 'ping', host: '8.8.8.8' }, impl({ ping: async () => { throw new Error(`адрес не из локальной сети (…)`) } }))
    assert.equal(s.detail, 'адрес не из локальной сети')
  })
})

describe('кэш состояний', () => {
  const dev = { kind: 'ping' as const, host: '192.168.1.5', port: null, url: null, enabled: true }
  const st = (state: Status['state'], at: number): Status => ({ state, checkedAt: at, latencyMs: 3, detail: null })
  it('не блокирует запрос и не чаще раза в 20 с на устройство', async () => {
    let t = 0
    let calls = 0
    const c = createStatusCache({ now: () => t, probe: async () => (calls++, st('online', t)) })
    const first = c.get(1, dev)
    assert.equal(first.status.state, 'checking') // ответ сразу, проверка в фоне
    await first.pending
    assert.equal(c.get(1, dev).status.state, 'online')
    t = 19_000
    assert.equal(c.get(1, dev).pending, null)
    assert.equal(calls, 1)
    t = 21_000
    const again = c.get(1, dev)
    assert.equal(again.status.state, 'online') // пока идёт повтор, показывается прежнее
    await again.pending
    assert.equal(calls, 2)
  })
  it('параллельные запросы не плодят проверки', async () => {
    let calls = 0
    const c = createStatusCache({ probe: async () => (calls++, st('offline', Date.now())) })
    const a = c.get(1, dev)
    const b = c.get(1, dev)
    assert.equal(b.pending, null)
    await a.pending
    assert.equal(calls, 1)
  })
  it('выключенное и без адреса не проверяются; смена адреса сбрасывает кэш', async () => {
    let calls = 0
    const c = createStatusCache({ probe: async (p: Probe) => (calls++, st('online', Date.now())) })
    assert.equal(c.get(1, { ...dev, enabled: false }).status.state, 'disabled')
    assert.equal(c.get(2, { ...dev, host: null }).status.state, 'unknown')
    assert.equal(calls, 0)
    await c.get(3, dev).pending
    const moved = c.get(3, { ...dev, host: '192.168.1.6' })
    assert.equal(moved.status.state, 'checking')
    await moved.pending
    assert.equal(calls, 2)
  })
  it('сбой проверки не роняет кэш', async () => {
    const c = createStatusCache({ probe: async () => { throw new Error('boom') } })
    await c.get(1, dev).pending
    assert.equal(c.get(1, dev).status.state, 'checking')
  })
})

describe('миграция БД', () => {
  it('таблица smart_devices со всеми полями и значениями по умолчанию', () => {
    const db = new Database(':memory:')
    db.exec(SMART_DEVICES_DDL)
    const cols = (db.prepare('PRAGMA table_info(smart_devices)').all() as { name: string }[]).map((c) => c.name)
    for (const c of ['id', 'name', 'kind', 'room', 'icon', 'host', 'port', 'url', 'notes', 'enabled', 'created_at', 'updated_at']) assert.ok(cols.includes(c), c)
    db.prepare("INSERT INTO smart_devices (name, kind, created_at, updated_at) VALUES ('x','ping',1,1)").run()
    const r = db.prepare('SELECT icon, enabled FROM smart_devices').get() as { icon: string; enabled: number }
    assert.deepEqual(r, { icon: 'other', enabled: 1 })
  })
})
