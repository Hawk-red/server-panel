// Разбор строк torrent-space-guard: новое предупреждение «torrents NOT paused» и неизменные пауза/возобновление.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

let d: typeof import('./detectors.js')
let n: typeof import('./notifier.js')

before(async () => {
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'detectors-test-'))
  process.env.NOTIFY_BOT_TOKEN = 'test-token'
  d = await import('./detectors.js')
  n = await import('./notifier.js')
})
after(() => setImmediate(() => process.exit(process.exitCode ?? 0)))

describe('guardWarnEvent', () => {
  it('разбирает предупреждение: свободно, порог, путь, время', () => {
    const e = d.guardWarnEvent('2026-10-19 03:15:01 LOW SPACE WARNING (9G < 10G) on /home/torrents-tmp - torrents NOT paused')
    assert.ok(e)
    assert.equal(e.kind, 'disk.lowspace')
    assert.equal(e.level, 'error')
    assert.equal(e.target, '/home/torrents-tmp')
    assert.deepEqual(e.details, { freeGb: 9, thresholdGb: 10, path: '/home/torrents-tmp' })
    assert.equal(e.ts, Date.parse('2026-10-19T03:15:01'))
  })
  it('порог 20 ГБ — предупреждение (warning), не ошибка', () => {
    const e = d.guardWarnEvent('2026-10-19 03:15:01 LOW SPACE WARNING (19G < 20G) on /home/torrents-tmp - torrents NOT paused')
    assert.equal(e?.level, 'warning')
  })
  it('не принимает старые строки паузы/возобновления и чужие строки', () => {
    assert.equal(d.guardWarnEvent('2026-10-18 21:45:01 LOW SPACE (19G < 20G) on /home/torrents-tmp - torrents paused'), null)
    assert.equal(d.guardWarnEvent('2026-10-18 21:50:01 LOW SPACE (19G < 20G) on /home/torrents-tmp - flag already set, 5 active torrents paused again'), null)
    assert.equal(d.guardWarnEvent('2026-10-19 00:00:00 SPACE OK (26G >= 25G) on /home/torrents-tmp - torrents resumed'), null)
    assert.equal(d.guardWarnEvent('2026-10-19 03:15:01 LOW SPACE WARNING (9G < 10G) on /home/torrents-tmp - torrents paused'), null)
  })
})

describe('текст Telegram', () => {
  it('SSD: сообщение по ТЗ', () => {
    const e = d.guardWarnEvent('2026-10-19 03:15:01 LOW SPACE WARNING (9G < 10G) on /home/torrents-tmp - torrents NOT paused')!
    assert.equal(n.lowSpaceText(e), '⚠️ Мало места на SSD: 9 ГБ. Торренты НЕ остановлены (автоостановка выключена). При 0 ГБ возможны сбои баз данных и сервисов')
  })
  it('HDD: подпись диска меняется', () => {
    const e = d.guardWarnEvent('2026-10-19 03:15:01 LOW SPACE WARNING (4G < 5G) on /mnt/hdd1tb/qbittorrent-downloads - torrents NOT paused')!
    assert.match(n.lowSpaceText(e), /^⚠️ Мало места на HDD 1TB: 4 ГБ\./)
  })
})
