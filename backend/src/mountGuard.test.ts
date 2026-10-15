// Разбор строк EVENT из /var/log/mount-guard.log (deploy/mount-guard) и их уведомления.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, describe, it } from 'node:test'

let d: typeof import('./detectors.js')
before(async () => {
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mount-guard-test-'))
  d = await import('./detectors.js')
})

describe('mount-guard → события', () => {
  it('mount.late без автозапуска: просит запустить вручную', () => {
    const e = d.mountGuardEvent('2026-10-16 00:01:02 EVENT mount.late disk=hdd1tb containers=qbittorrent,sftpgo action=none')!
    assert.equal(e.kind, 'mount.late')
    assert.equal(e.level, 'warning')
    assert.match(e.text, /hdd1tb смонтирован с опозданием, контейнеры qbittorrent, sftpgo не запущены — запустите вручную/)
    assert.deepEqual((e.details as { containers: string[] }).containers, ['qbittorrent', 'sftpgo'])
  })
  it('mount.late с автозапуском: перечисляет запущенные', () => {
    const e = d.mountGuardEvent('2026-10-16 00:01:02 EVENT mount.late disk=hdd1tb containers=qbittorrent,sftpgo action=started started=qbittorrent')!
    assert.match(e.text, /запущены контейнеры: qbittorrent/)
  })
  it('mount.failed — error', () => {
    const e = d.mountGuardEvent('2026-10-16 00:04:02 EVENT mount.failed disk=hdd1tb mnt=/mnt/hdd1tb reason=no-device')!
    assert.equal(e.level, 'error')
    assert.match(e.text, /не смонтирован при загрузке \(устройство не появилось\)/)
  })
  it('обычные строки лога и чужие события игнорируются', () => {
    assert.equal(d.mountGuardEvent('2026-10-16 00:01:02 hdd1tb: уже смонтирован'), null)
    assert.equal(d.mountGuardEvent('2026-10-16 00:01:02 EVENT other disk=x'), null)
  })
})
