import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { ALERT_EVENTS_DDL } from './alertSchema.js'
import { ingestAlerts, scanLog } from './alertEvents.js'

const mk = () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;' + ALERT_EVENTS_DDL)
  const dir = mkdtempSync(path.join(tmpdir(), 'alert-test-'))
  return { db, log: path.join(dir, 'alert_monitor.log') }
}
const n = (db: Database.Database) => (db.prepare('SELECT COUNT(*) c FROM alert_events').get() as { c: number }).c

const OLD = '2026-07-21 18:37:56,890 [WARNING] ОБНАРУЖЕНО СОВПАДЕНИЕ (ключ: київ): 🛵 Реактивний БпЛА на Київ\n'
const POLL = '2026-08-01 01:38:19,100 [WARNING] [poll] СОВПАДЕНИЕ (моє місто: києв): 🚀Балістична ракета у напрямку Києва.\n'
const MULTI = '2026-08-29 06:06:53,000 [WARNING] [poll] СОВПАДЕНИЕ (дрон): 🏍 Реактивний БпЛА над Києвом.\n🏍 Реактивні БпЛА в районі водосховища.\n'
const NOISE = '2026-08-29 06:06:54,000 [INFO] ⏱ [poll] Публикация: 06:06:53 | Задержка: 1.0 сек\n'

test('оба формата, многострочный текст, идемпотентность', () => {
  const { db, log } = mk()
  writeFileSync(log, OLD + NOISE + POLL + MULTI + NOISE)
  assert.equal(ingestAlerts(db, log).added, 3)
  assert.equal(ingestAlerts(db, log).added, 0)
  assert.equal(n(db), 3)
  const multi = db.prepare("SELECT text FROM alert_events WHERE reason='дрон'").get() as { text: string }
  assert.equal(multi.text.split('\n').length, 2)
})
test('недописанная запись в конце файла ждёт завершения, без дублей', () => {
  const { db, log } = mk()
  writeFileSync(log, OLD + MULTI) // MULTI — последняя, не подтверждена следующей меткой
  assert.equal(ingestAlerts(db, log).added, 1)
  appendFileSync(log, NOISE)
  assert.equal(ingestAlerts(db, log).added, 1)
  assert.equal(n(db), 2)
})
test('ротация: хвост старого файла и новый файл', () => {
  const { db, log } = mk()
  writeFileSync(log, OLD + NOISE)
  ingestAlerts(db, log)
  appendFileSync(log, POLL + NOISE) // записано после последнего прохода, затем ротация
  renameSync(log, log + '.1')
  writeFileSync(log, MULTI + NOISE)
  assert.equal(ingestAlerts(db, log).added, 2)
  assert.equal(n(db), 3)
})
test('бэкфилл из .1/.2 и текущего', () => {
  const { db, log } = mk()
  writeFileSync(log + '.2', OLD + NOISE)
  writeFileSync(log + '.1', POLL + NOISE)
  writeFileSync(log, MULTI + NOISE)
  const r = ingestAlerts(db, log)
  assert.equal(r.backfill, true)
  assert.equal(n(db), 3)
  assert.equal(scanLog(log, 0, true).records.length, 1)
})
