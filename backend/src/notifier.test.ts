// Тесты уведомлений на подставном Telegram API: тихие часы по Киеву (disable_notification), отсутствие накопления,
// ограничение лавины, дедупликация, выключенная «Утренняя сводка». Реальные сообщения не отправляются.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, beforeEach, describe, it } from 'node:test'

type Sent = { method: string; body: Record<string, unknown> }
let n: typeof import('./notifier.js')
let st: typeof import('./settings.js')
let sent: Sent[] = []
let now = Date.parse('2026-07-15T12:00:00Z')
const fake = async (method: string, body: Record<string, unknown>) => {
  sent.push({ method, body })
  return {}
}
const setNotify = (over: Record<string, unknown> = {}) =>
  n.saveNotifySettings({ ...n.getNotifySettings(), chatId: 1, enabled: true, ...over } as never)
const at = (iso: string) => (now = Date.parse(iso))

before(async () => {
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'notify-test-'))
  process.env.NOTIFY_BOT_TOKEN = 'test-token'
  n = await import('./notifier.js')
  st = await import('./settings.js')
})
beforeEach(() => {
  sent = []
  at('2026-07-15T12:00:00Z')
  n.__test.setup(fake, () => now)
  st.setSetting('notify', {})
  st.setSetting('notify.queue', [])
  setNotify()
})

describe('тихие часы по Киеву', () => {
  const quiet = (iso: string) => n.inQuietHours(new Date(iso))
  it('границы летом (UTC+3)', () => {
    assert.equal(quiet('2026-07-15T20:59:00Z'), false) // 23:59
    assert.equal(quiet('2026-07-15T21:00:00Z'), true) // 00:00
    assert.equal(quiet('2026-07-16T05:59:00Z'), true) // 08:59
    assert.equal(quiet('2026-07-16T06:00:00Z'), false) // 09:00
  })
  it('границы зимой (UTC+2)', () => {
    assert.equal(quiet('2026-01-15T21:59:00Z'), false) // 23:59
    assert.equal(quiet('2026-01-15T22:00:00Z'), true) // 00:00
    assert.equal(quiet('2026-01-16T06:59:00Z'), true) // 08:59
    assert.equal(quiet('2026-01-16T07:00:00Z'), false) // 09:00
  })
  it('переход на летнее время (29.03.2026)', () => {
    assert.equal(quiet('2026-03-28T21:59:00Z'), false) // 23:59 (+2)
    assert.equal(quiet('2026-03-28T22:00:00Z'), true) // 00:00 (+2)
    assert.equal(quiet('2026-03-29T05:59:00Z'), true) // 08:59 (+3)
    assert.equal(quiet('2026-03-29T06:00:00Z'), false) // 09:00 (+3)
  })
  it('переход на зимнее время (25.10.2026)', () => {
    assert.equal(quiet('2026-10-24T20:59:00Z'), false) // 23:59 (+3)
    assert.equal(quiet('2026-10-24T21:00:00Z'), true) // 00:00 (+3)
    assert.equal(quiet('2026-10-25T06:59:00Z'), true) // 08:59 (+2)
    assert.equal(quiet('2026-10-25T07:00:00Z'), false) // 09:00 (+2)
  })
  it('границы настраиваются', () => {
    assert.equal(n.inQuietHours(new Date('2026-07-15T19:00:00Z'), { from: '22:00', to: '06:00' }), true) // 22:00
    assert.equal(n.inQuietHours(new Date('2026-07-15T18:59:00Z'), { from: '22:00', to: '06:00' }), false)
  })
  it('старые границы по умолчанию 23–08 заменяются на 00–09', () => {
    st.setSetting('notify', { quiet: { from: '23:00', to: '08:00' } })
    assert.deepEqual(n.getNotifySettings().quiet, { from: '00:00', to: '09:00' })
    st.setSetting('notify', { quiet: { from: '22:00', to: '07:00' } })
    assert.deepEqual(n.getNotifySettings().quiet, { from: '22:00', to: '07:00' })
  })
})

describe('disable_notification', () => {
  const cases: [string, boolean][] = [
    ['2026-07-15T20:59:00Z', false],
    ['2026-07-15T21:00:00Z', true],
    ['2026-07-16T05:59:00Z', true],
    ['2026-07-16T06:00:00Z', false],
    ['2026-03-29T05:59:00Z', true],
    ['2026-03-29T06:00:00Z', false],
    ['2026-10-25T06:59:00Z', true],
    ['2026-10-25T07:00:00Z', false],
  ]
  for (const [iso, silent] of cases)
    it(`${iso} → disable_notification=${silent}`, async () => {
      at(iso)
      await n.send('событие', false)
      assert.equal(sent.length, 1)
      assert.equal(sent[0].body.disable_notification, silent)
    })
  it('срочные и безопасность ночью тоже без звука', async () => {
    at('2026-07-15T23:00:00Z')
    await n.send('срочное', true)
    assert.equal(sent[0].body.disable_notification, true)
  })
})

describe('без накопления', () => {
  it('ночью событие уходит сразу, очередь пуста', async () => {
    at('2026-07-16T00:30:00Z')
    await n.send('ночное', false)
    assert.equal(sent.length, 1)
    assert.deepEqual(st.getSetting('notify.queue', []), [])
  })
  it('«Утренняя сводка» выключена по умолчанию', () => {
    assert.equal(n.getNotifySettings().digest, false)
  })
  it('включённая сводка по-прежнему копит обычные события и пропускает срочные', async () => {
    setNotify({ digest: true })
    at('2026-07-16T00:30:00Z')
    await n.send('обычное', false)
    await n.send('срочное', true)
    assert.equal(sent.length, 1)
    assert.match(String(sent[0].body.text), /срочное/)
    assert.equal((st.getSetting('notify.queue', []) as unknown[]).length, 1)
  })
  it('накопленное раньше при выключенной сводке не теряется: уходит одним сообщением', async () => {
    st.setSetting('notify.queue', [{ ts: now, text: 'старое' }])
    await n.flushQueue()
    assert.equal(sent.length, 1)
    assert.match(String(sent[0].body.text), /старое/)
    assert.deepEqual(st.getSetting('notify.queue', []), [])
  })
})

describe('лавина и дубли', () => {
  it('не больше 20 сообщений в минуту, остальное — одно «ещё N событий»', async () => {
    for (let i = 0; i < 35; i++) await n.send(`событие ${i}`, false)
    assert.equal(sent.length, 20)
    await n.flushOverflow()
    assert.equal(sent.length, 21)
    const last = String(sent[20].body.text)
    assert.match(last, /ещё 15 событий/)
    assert.match(last, /событие 20/)
    assert.match(last, /событие 34/)
  })
  it('сводка лавины ночью тоже беззвучная', async () => {
    at('2026-07-16T01:00:00Z')
    for (let i = 0; i < 25; i++) await n.send(`событие ${i}`, false)
    await n.flushOverflow()
    assert.equal(sent.length, 21)
    assert.ok(sent.every((x) => x.body.disable_notification === true))
  })
  it('новая минута — новое окно; хвост предыдущей минуты уходит сводкой', async () => {
    for (let i = 0; i < 22; i++) await n.send(`событие ${i}`, false)
    now += 61_000
    await n.send('после паузы', false)
    const texts = sent.map((x) => String(x.body.text))
    assert.equal(sent.length, 22) // 20 + «ещё 2» + «после паузы» − ... проверим состав ниже
    assert.ok(texts.some((t) => /ещё 2 событий/.test(t)))
    assert.equal(texts.at(-1), 'после паузы')
  })
  it('одинаковые подряд не повторяются, разные — идут', async () => {
    await n.send('диск 91%', false)
    await n.send('диск 91%', false)
    await n.send('диск 91%', false)
    await n.send('другое', false)
    await n.send('диск 91%', false)
    assert.deepEqual(sent.map((x) => x.body.text), ['диск 91%', 'другое', 'диск 91%'])
  })
  it('то же событие через 10+ минут отправляется снова', async () => {
    await n.send('служба упала', false)
    now += 11 * 60_000
    await n.send('служба упала', false)
    assert.equal(sent.length, 2)
  })
})

describe('правила и общие настройки', () => {
  it('выключенные уведомления ничего не отправляют', async () => {
    setNotify({ enabled: false })
    await n.send('x', true)
    assert.equal(sent.length, 0)
  })
  it('правила по темам не изменились (все включены)', () => {
    const r = n.getNotifySettings().rules
    for (const id of ['torrents', 'updates', 'unit', 'disk', 'device']) assert.equal((r as Record<string, boolean>)[id], true)
  })
})
