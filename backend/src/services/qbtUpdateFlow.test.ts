// Тесты «Остановить торренты и обновить» и «Остановить все / Запустить все» на подставном qBittorrent API
// (локальный HTTP-сервер в памяти) и подставном помощнике. Реальные торренты и контейнеры не затрагиваются.
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

type T = { hash: string; name: string; size: number; progress: number; state: string; dlspeed: number; upspeed: number; save_path: string }
const H = (n: number) => String(n).padStart(40, '0')
let torrents: T[] = []
let calls: { path: string; hashes: string[] }[] = []
let apiDown = false
let stuck = false // «остановка» не срабатывает
const mk = (n: number, name: string, progress: number, state: string): T => ({ hash: H(n), name, size: 1000, progress, state, dlspeed: 0, upspeed: 0, save_path: '/downloads-tmp' })

const server = http.createServer((req, res) => {
  if (apiDown) return void req.socket.destroy()
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    if (req.url === '/api/v2/auth/login') {
      res.writeHead(204, { 'Set-Cookie': 'QBT_SID_8090=abc; HttpOnly' })
      return void res.end()
    }
    if (!(req.headers.cookie ?? '').includes('QBT_SID_8090=abc')) {
      res.writeHead(403)
      return void res.end()
    }
    if (req.url === '/api/v2/torrents/info') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return void res.end(JSON.stringify(torrents))
    }
    if (req.url === '/api/v2/torrents/stop' || req.url === '/api/v2/torrents/start') {
      const hashes = (new URLSearchParams(body).get('hashes') ?? '').split('|')
      calls.push({ path: req.url, hashes })
      assert.ok(!hashes.includes('all'), 'hashes=all не должен использоваться')
      for (const t of torrents) {
        if (!hashes.includes(t.hash)) continue
        if (req.url.endsWith('stop')) {
          if (!stuck) t.state = t.progress < 1 ? 'stoppedDL' : 'stoppedUP'
        } else t.state = t.progress < 1 ? 'downloading' : 'uploading'
      }
      res.writeHead(200)
      return void res.end()
    }
    res.writeHead(404)
    res.end()
  })
})

type Mods = {
  flow: typeof import('./qbtUpdateFlow.js')
  ctl: typeof import('./torrentControl.js')
  qbt: typeof import('./qbittorrent.js')
  settings: typeof import('../settings.js')
}
let m: Mods

// подставной помощник
type Job = { id: string; container: string; status: string; summary: string | null; error: string | null; startedAt: number }
let jobs: Record<string, Job> = {}
let moveRunning: boolean | 'error' = false
let startJobError: Error | null = null
let started: string[] = []
let nowMs = 1_000_000
const deps = () => ({
  listTorrents: m.qbt.listTorrents,
  stopHashes: m.qbt.stopHashes,
  startHashes: m.qbt.startHashes,
  startJob: async (_a: string, name: string) => {
    if (startJobError) throw startJobError
    const id = `20261009-000000-${String(started.length).padStart(6, '0')}`
    jobs[id] = { id, container: name, status: 'running', summary: null, error: null, startedAt: nowMs }
    started.push(id)
    return id
  },
  getJob: async (id: string) => (jobs[id] as never) ?? null,
  runningJob: async () => (Object.values(jobs).find((j) => j.status === 'running') as never) ?? null,
  moveRunning: async () => {
    if (moveRunning === 'error') throw new Error('proxy down')
    return moveRunning
  },
  isManaged: async () => true,
  now: () => nowMs,
  sleep: async (ms: number) => void (nowMs += ms),
  stopWaitMs: 5000,
  resumeWaitMs: 60_000,
})

before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'flow-test-'))
  process.env.QBT_URL = `http://127.0.0.1:${port}`
  process.env.QBT_USER = 'a'
  process.env.QBT_PASSWORD = 'b'
  m = {
    flow: await import('./qbtUpdateFlow.js'),
    ctl: await import('./torrentControl.js'),
    qbt: await import('./qbittorrent.js'),
    settings: await import('../settings.js'),
  }
})
after(() => server.close())
beforeEach(() => {
  torrents = [mk(1, 'D1 stalled 30%', 0.3, 'stalledDL'), mk(2, 'D2 downloading', 0.5, 'downloading'), mk(3, 'U1 seeding', 1, 'uploading'), mk(4, 'M manual stop', 0.2, 'stoppedDL')]
  calls = []
  apiDown = false
  stuck = false
  jobs = {}
  moveRunning = false
  startJobError = null
  started = []
  nowMs = 1_000_000
  m.settings.setSetting('qbt.updateFlow', null)
  m.settings.setSetting('torrents.panelStopped', [])
})
const state = (n: number) => torrents.find((t) => t.hash === H(n))!.state

describe('Остановить все / Запустить все', () => {
  it('останавливает работающие, запоминает; «запустить» возобновляет только их, вручную остановленные не трогает', async () => {
    const r = await m.ctl.stopAllTorrents()
    assert.deepEqual(r, { stopped: 3, alreadyStopped: 1, total: 4 })
    assert.deepEqual([state(1), state(2), state(3), state(4)], ['stoppedDL', 'stoppedDL', 'stoppedUP', 'stoppedDL'])
    assert.equal(m.ctl.panelStoppedHashes().length, 3) // хранится в panel.db
    const info = await m.ctl.panelStoppedInfo()
    assert.equal(info.count, 3)
    assert.equal(info.stoppedManually, 1)
    const s = await m.ctl.startPanelStopped()
    assert.equal(s.started, 3)
    assert.equal(s.leftStoppedManually, 1)
    assert.deepEqual([state(1), state(2), state(3), state(4)], ['downloading', 'downloading', 'uploading', 'stoppedDL'])
    assert.deepEqual(m.ctl.panelStoppedHashes(), [])
  })
  it('«запустить» без запомненных ничего не делает', async () => {
    const s = await m.ctl.startPanelStopped()
    assert.equal(s.started, 0)
    assert.equal(state(4), 'stoppedDL')
    assert.equal(calls.length, 0)
  })
})

describe('Остановить торренты и обновить', () => {
  it('успех: останавливает только держащие замок, обновляет, возобновляет только запомненные', async () => {
    const d = deps()
    const f = await m.flow.startFlow('1.2.3.4', d)
    assert.equal(f.phase, 'updating')
    assert.equal(f.stoppedCount, 2)
    assert.deepEqual([state(1), state(2), state(3), state(4)], ['stoppedDL', 'stoppedDL', 'uploading', 'stoppedDL']) // сидирование и ручная остановка не затронуты
    assert.equal(calls.filter((c) => c.path.endsWith('start')).length, 0)
    await m.flow.tickFlow(d)
    assert.equal(m.flow.getFlow()!.phase, 'updating') // задача ещё идёт
    jobs[f.jobId!].status = 'ok'
    jobs[f.jobId!].summary = 'обновлено'
    await m.flow.tickFlow(d)
    assert.equal(m.flow.getFlow()!.phase, 'resuming')
    await m.flow.tickFlow(d) // отправили start
    assert.deepEqual([state(1), state(2), state(3), state(4)], ['downloading', 'downloading', 'uploading', 'stoppedDL'])
    const startCall = calls.filter((c) => c.path.endsWith('start')).at(-1)!
    assert.deepEqual(startCall.hashes.sort(), [H(1), H(2)])
    await m.flow.tickFlow(d)
    const done = m.flow.getFlow()!
    assert.equal(done.phase, 'done')
    assert.equal(done.resumedCount, 2)
    assert.equal(done.jobStatus, 'ok')
  })
  it('откат обновления: торренты всё равно возобновляются', async () => {
    const d = deps()
    const f = await m.flow.startFlow('ip', d)
    jobs[f.jobId!].status = 'rolledback'
    for (let i = 0; i < 4; i++) await m.flow.tickFlow(d)
    const done = m.flow.getFlow()!
    assert.equal(done.phase, 'done')
    assert.equal(done.jobStatus, 'rolledback')
    assert.deepEqual([state(1), state(2), state(4)], ['downloading', 'downloading', 'stoppedDL'])
  })
  it('провал обновления (failed): торренты возобновляются', async () => {
    const d = deps()
    const f = await m.flow.startFlow('ip', d)
    jobs[f.jobId!].status = 'failed'
    for (let i = 0; i < 4; i++) await m.flow.tickFlow(d)
    assert.equal(m.flow.getFlow()!.phase, 'done')
    assert.equal(state(1), 'downloading')
  })
  it('qBittorrent поднимается не сразу: возобновление ждёт, пока API ответит', async () => {
    const d = deps()
    const f = await m.flow.startFlow('ip', d)
    jobs[f.jobId!].status = 'ok'
    await m.flow.tickFlow(d) // -> resuming
    apiDown = true
    await m.flow.tickFlow(d)
    await m.flow.tickFlow(d)
    assert.equal(m.flow.getFlow()!.phase, 'resuming')
    apiDown = false
    for (let i = 0; i < 3; i++) await m.flow.tickFlow(d)
    assert.equal(m.flow.getFlow()!.phase, 'done')
    assert.equal(state(2), 'downloading')
  })
  it('отказ при moving: ничего не останавливается', async () => {
    torrents.push(mk(5, 'MOVE', 1, 'moving'))
    await assert.rejects(m.flow.startFlow('ip', deps()), /перенос или проверка/)
    assert.equal(calls.length, 0)
    assert.equal(started.length, 0)
  })
  it('отказ при checking*', async () => {
    torrents.push(mk(5, 'CHK', 0.5, 'checkingResumeData'))
    await assert.rejects(m.flow.startFlow('ip', deps()), /перенос или проверка/)
    assert.equal(calls.length, 0)
  })
  it('отказ, если работает move-completed.sh; отказ, если проверить не удалось', async () => {
    moveRunning = true
    await assert.rejects(m.flow.startFlow('ip', deps()), /move-completed/)
    moveRunning = 'error'
    await assert.rejects(m.flow.startFlow('ip', deps()), /не удалось проверить/)
    assert.equal(calls.length, 0)
  })
  it('предпросмотр показывает, что остановится и что мешает, и ничего не меняет', async () => {
    torrents.push(mk(5, 'MOVE', 1, 'moving'))
    const p = await m.flow.previewFlow(deps())
    assert.deepEqual(p.torrents.map((t) => t.name).sort(), ['D1 stalled 30%', 'D2 downloading'])
    assert.equal(p.blockers.length, 1)
    assert.equal(calls.length, 0)
  })
  it('помощник не запустился: торренты возвращены, процесс закрыт с ошибкой', async () => {
    const { StartError } = await import('./dockerManage.js')
    startJobError = new StartError('замок: идут закачки')
    await assert.rejects(m.flow.startFlow('ip', deps()), /замок/)
    assert.deepEqual([state(1), state(2), state(4)], ['downloading', 'downloading', 'stoppedDL'])
    assert.equal(m.flow.getFlow()!.phase, 'error')
  })
  it('торренты не остановились вовремя: возврат и отказ', async () => {
    stuck = true
    await assert.rejects(m.flow.startFlow('ip', deps()), /не остановились/)
    assert.equal(started.length, 0)
    assert.equal(m.flow.getFlow()!.phase, 'error')
  })
  it('второй процесс параллельно не стартует', async () => {
    await m.flow.startFlow('ip', deps())
    await assert.rejects(m.flow.startFlow('ip', deps()), /уже идёт/)
  })
})

describe('Перезапуск панели посреди процесса', () => {
  const persisted = (phase: string, extra: object = {}) =>
    m.settings.setSetting('qbt.updateFlow', {
      id: 'x', phase, torrents: [mk(1, 'D1', 0.3, 'x'), mk(2, 'D2', 0.5, 'x')].map((t) => ({ hash: t.hash, name: t.name, size: 1, progress: t.progress, state: t.state })),
      startedAt: nowMs - 1000, finishedAt: null, jobId: null, jobStatus: null, jobSummary: null, stoppedCount: 2, resumedCount: null, resumeDeadline: null, error: null, ...extra,
    })
  it('остановка была, обновление не начиналось → торренты возвращаются', async () => {
    torrents[0].state = 'stoppedDL'
    torrents[1].state = 'stoppedDL'
    persisted('stopping')
    const d = deps()
    for (let i = 0; i < 4; i++) await m.flow.tickFlow(d)
    assert.equal(m.flow.getFlow()!.phase, 'done')
    assert.deepEqual([state(1), state(2), state(4)], ['downloading', 'downloading', 'stoppedDL'])
  })
  it('обновление шло и закончилось, пока панель была выключена → торренты возобновляются', async () => {
    torrents[0].state = 'stoppedDL'
    torrents[1].state = 'stoppedDL'
    jobs['20261009-000000-000009'] = { id: '20261009-000000-000009', container: 'qbittorrent', status: 'ok', summary: 'ок', error: null, startedAt: nowMs }
    persisted('updating', { jobId: '20261009-000000-000009' })
    const d = deps()
    for (let i = 0; i < 4; i++) await m.flow.tickFlow(d)
    assert.equal(m.flow.getFlow()!.phase, 'done')
    assert.equal(m.flow.getFlow()!.jobStatus, 'ok')
    assert.deepEqual([state(1), state(2), state(4)], ['downloading', 'downloading', 'stoppedDL'])
  })
  it('обновление ещё идёт после перезапуска панели → продолжаем ждать', async () => {
    jobs['20261009-000000-000008'] = { id: '20261009-000000-000008', container: 'qbittorrent', status: 'running', summary: null, error: null, startedAt: nowMs }
    persisted('updating', { jobId: '20261009-000000-000008' })
    await m.flow.tickFlow(deps())
    assert.equal(m.flow.getFlow()!.phase, 'updating')
  })
  it('qBittorrent так и не поднялся до крайнего срока → ошибка, а «Запустить все» потом вернёт эти торренты', async () => {
    torrents[0].state = 'stoppedDL'
    torrents[1].state = 'stoppedDL'
    persisted('resuming', { resumeDeadline: nowMs - 1 })
    apiDown = true
    const d = deps()
    await m.flow.tickFlow(d)
    assert.equal(m.flow.getFlow()!.phase, 'error')
    apiDown = false
    const s = await m.ctl.startPanelStopped()
    assert.equal(s.started, 2)
    assert.equal(state(4), 'stoppedDL')
  })
})
