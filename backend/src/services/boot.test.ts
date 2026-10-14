// Тесты события о перезагрузке на подставных зависимостях (boot id, часы, метрики, журнал): без реального journalctl и Telegram.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

let b: typeof import('./boot.js')
let st: typeof import('../settings.js')
let n: typeof import('../notifier.js')
let ev: typeof import('../events.js')
let db: typeof import('../db.js')
const NOW = Date.parse('2026-10-14T12:00:00Z')
const emitted: { kind: string; level: string; text: string; details?: unknown }[] = []
const deps = (over: Partial<import('./boot.js').BootDeps> = {}): import('./boot.js').BootDeps => ({
  bootId: () => 'boot-2',
  now: () => NOW,
  uptimeSec: () => 60, // включился за минуту до запуска панели
  lastMetricTs: () => NOW - 60_000 - 11 * 60_000, // метрики встали за 11 минут до включения
  cleanShutdown: async () => false,
  ...over,
})

before(async () => {
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'boot-test-'))
  process.env.NOTIFY_BOT_TOKEN = 'test-token'
  b = await import('./boot.js')
  st = await import('../settings.js')
  n = await import('../notifier.js')
  ev = await import('../events.js')
  db = await import('../db.js')
  ev.onEvent((e) => emitted.push(e))
})
// startNotifier() заводит таймеры — без принудительного выхода процесс теста не завершится
after(() => setImmediate(() => process.exit(process.exitCode ?? 0)))
beforeEach(() => {
  emitted.length = 0
  st.setSetting(b.BOOT_KEY, 'boot-1')
})

describe('событие о перезагрузке', () => {
  it('аварийное отключение: текст с простоем в минутах', async () => {
    const r = await b.detectBoot(deps())
    assert.equal(r.kind, 'crash')
    assert.equal(emitted.length, 1)
    assert.equal(emitted[0].text, 'Сервер включился после аварийного отключения. Простой был около 11 минут')
    assert.equal(emitted[0].level, 'warning')
    assert.equal(st.getSetting(b.BOOT_KEY, ''), 'boot-2')
  })
  it('штатная перезагрузка: «Сервер перезагружен» без слова «аварийно»', async () => {
    const r = await b.detectBoot(deps({ cleanShutdown: async () => true }))
    assert.equal(r.kind, 'clean')
    assert.equal(emitted[0].text, 'Сервер перезагружен')
    assert.ok(!/аварий/.test(emitted[0].text))
  })
  it('перезапуск службы панели без перезагрузки: события нет', async () => {
    st.setSetting(b.BOOT_KEY, 'boot-2')
    const r = await b.detectBoot(deps())
    assert.equal(r.kind, 'restart')
    assert.equal(emitted.length, 0)
  })
  it('повторный запуск панели на той же загрузке не даёт дубль', async () => {
    await b.detectBoot(deps())
    await b.detectBoot(deps())
    assert.equal(emitted.length, 1)
  })
  it('первый запуск (нет сохранённого boot id): запоминаем, события нет', async () => {
    db.db.prepare("DELETE FROM settings WHERE key = ?").run(b.BOOT_KEY)
    const r = await b.detectBoot(deps())
    assert.equal(r.kind, 'first')
    assert.equal(emitted.length, 0)
    assert.equal(st.getSetting(b.BOOT_KEY, ''), 'boot-2')
  })
  it('журнал недоступен: решает разрыв в метриках', async () => {
    assert.equal((await b.detectBoot(deps({ cleanShutdown: async () => null }))).kind, 'crash') // 11 минут > порога
    st.setSetting(b.BOOT_KEY, 'boot-1')
    assert.equal((await b.detectBoot(deps({ cleanShutdown: async () => null, lastMetricTs: () => NOW - 60_000 - 90_000 }))).kind, 'clean')
  })
  it('нет метрик вообще: аварийное без числа минут', async () => {
    await b.detectBoot(deps({ lastMetricTs: () => null }))
    assert.equal(emitted[0].text, 'Сервер включился после аварийного отключения')
  })
  it('склонение минут', () => {
    assert.deepEqual([1, 2, 5, 11, 14, 21, 22, 25].map(b.minutesWord), ['минуту', 'минуты', 'минут', 'минут', 'минут', 'минуту', 'минуты', 'минут'])
  })
})

describe('Telegram: правило boot', () => {
  let sent: Record<string, unknown>[] = []
  let clock = Date.parse('2026-10-14T12:00:00Z')
  beforeEach(() => {
    sent = []
    n.__test.setup(async (_m, body) => void sent.push(body), () => clock)
    st.setSetting('notify', {})
    n.saveNotifySettings({ ...n.getNotifySettings(), chatId: 1, enabled: true })
  })
  const emit = () => ev.emitEvent({ kind: 'server.boot', level: 'warning', text: 'Сервер включился после аварийного отключения. Простой был около 3 минут', details: { crash: true } })
  it('по умолчанию включено; днём со звуком, ночью (00–09 Киев) беззвучно', async () => {
    assert.equal(n.getNotifySettings().rules.boot, true)
    n.startNotifier({ warn() {}, debug() {} } as never)
    emit()
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(sent.length, 1)
    assert.equal(sent[0].disable_notification, false)
    assert.match(String(sent[0].text), /аварийного отключения/)
    clock = Date.parse('2026-10-14T00:30:00Z') // 03:30 по Киеву
    n.__test.setup(async (_m, body) => void sent.push(body), () => clock)
    emit()
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(sent.at(-1)!.disable_notification, true)
  })
  it('выключенное правило ничего не отправляет', async () => {
    const s = n.getNotifySettings()
    n.saveNotifySettings({ ...s, rules: { ...s.rules, boot: false } })
    sent = []
    emit()
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(sent.length, 0)
  })
})
