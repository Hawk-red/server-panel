// «Остановить торренты и обновить»: безопасный путь обновить qBittorrent, когда замок держат незавершённые закачки.
//   1. отказ, если идёт перенос файлов (move-completed.sh) или есть moving / checking*;
//   2. запоминаем активные закачки (те, что держат замок помощника) → останавливаем → ждём состояния stopped*;
//   3. обычное обновление через root-помощника (его замок НЕ ослаблен: stopped/paused закачкой не считаются);
//   4. после любого исхода (успех, ошибка, откат) возобновляем ТОЛЬКО запомненные торренты.
// Состояние хранится в panel.db: если панель перезапустилась посреди процесса, при старте торренты возвращаются в прежний вид.
// Ничего не удаляется. Зависимости (qBittorrent, помощник, часы) подменяются в тестах.
import { emitEvent } from '../events.js'
import { getSetting, setSetting } from '../settings.js'
import { config } from '../config.js'
import { http } from '../http.js'
import { getDockerJob, isManaged, runningDockerJob, startDockerJob, StartError, type DockerJob } from './dockerManage.js'
import * as qbt from './qbittorrent.js'
import { rememberStopped } from './torrentControl.js'

export type FlowPhase = 'stopping' | 'updating' | 'resuming' | 'done' | 'error'
export type FlowTorrent = { hash: string; name: string; size: number; progress: number; state: string }
export type Flow = {
  id: string
  phase: FlowPhase
  torrents: FlowTorrent[] // что остановили (и вернём)
  startedAt: number
  finishedAt: number | null
  jobId: string | null
  jobStatus: DockerJob['status'] | null
  jobSummary: string | null
  stoppedCount: number
  resumedCount: number | null
  resumeDeadline: number | null
  error: string | null
}

export class FlowError extends Error {
  constructor(
    message: string,
    public statusCode = 409
  ) {
    super(message)
  }
}

export type FlowDeps = {
  listTorrents: typeof qbt.listTorrents
  stopHashes: typeof qbt.stopHashes
  startHashes: typeof qbt.startHashes
  startJob: (action: 'update' | 'rollback', name: string, ip: string) => Promise<string>
  getJob: (id: string) => Promise<DockerJob | null>
  runningJob: () => Promise<DockerJob | null>
  moveRunning: () => Promise<boolean> // идёт ли move-completed.sh в контейнере; ошибка = «не удалось проверить»
  isManaged: (name: string) => Promise<boolean>
  now: () => number
  sleep: (ms: number) => Promise<void>
  stopWaitMs: number
  resumeWaitMs: number
}

// Идёт ли в контейнере move-completed.sh: GET /containers/qbittorrent/top через docker-socket-proxy
async function realMoveRunning(): Promise<boolean> {
  const res = await http(`${config.dockerProxy}/containers/qbittorrent/top`, { timeoutMs: 6000 })
  const top = (await res.json()) as { Processes?: string[][] }
  return (top.Processes ?? []).some((row) => row.join(' ').includes('move-completed'))
}

export const realDeps: FlowDeps = {
  listTorrents: qbt.listTorrents,
  stopHashes: qbt.stopHashes,
  startHashes: qbt.startHashes,
  startJob: startDockerJob,
  getJob: async (id) => (await getDockerJob(id, 0)) as DockerJob | null,
  runningJob: runningDockerJob,
  moveRunning: realMoveRunning,
  isManaged,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  stopWaitMs: 60_000,
  resumeWaitMs: 10 * 60_000,
}

const KEY = 'qbt.updateFlow'
const ACTIVE: FlowPhase[] = ['stopping', 'updating', 'resuming']
const FINAL_JOB: DockerJob['status'][] = ['ok', 'error', 'rolledback', 'failed']
const lockHolds = (t: qbt.TorrentLite) => t.progress < 1 && !qbt.isStoppedState(t.state) // как у замка помощника
const blocking = (t: qbt.TorrentLite) => t.state === 'moving' || /^checking/.test(t.state)

export const getFlow = () => getSetting<Flow | null>(KEY, null)
const save = (f: Flow) => setSetting(KEY, f)
export const flowActive = (f: Flow | null) => !!f && ACTIVE.includes(f.phase)

// Что остановится и что мешает (для диалога); ничего не меняет
export async function previewFlow(d: FlowDeps = realDeps) {
  const all = await d.listTorrents()
  const blockers: string[] = []
  const bad = all.filter(blocking)
  if (bad.length) blockers.push(`идут перенос или проверка файлов: ${bad.map((t) => t.name).slice(0, 3).join(', ')}${bad.length > 3 ? '…' : ''}`)
  try {
    if (await d.moveRunning()) blockers.push('работает move-completed.sh (перенос завершённой закачки)')
  } catch {
    blockers.push('не удалось проверить, работает ли move-completed.sh')
  }
  const fl = getFlow()
  if (flowActive(fl)) blockers.push('такой процесс уже идёт')
  const hold = all.filter(lockHolds).map((t) => ({ hash: t.hash, name: t.name, size: t.size, progress: t.progress, state: t.state }))
  return { torrents: hold, blockers, total: all.length }
}

let busyFlowId: string | null = null // поток, который сейчас ведёт startFlow (tick его не трогает)

export async function startFlow(ip: string, d: FlowDeps = realDeps): Promise<Flow> {
  if (flowActive(getFlow())) throw new FlowError('такой процесс уже идёт')
  if (!(await d.isManaged('qbittorrent'))) throw new FlowError('qBittorrent не подключён к обновлению из панели')
  const busy = await d.runningJob()
  if (busy) throw new FlowError(`уже выполняется задача для ${busy.container}`)
  let all: qbt.TorrentLite[]
  try {
    all = await d.listTorrents()
  } catch (e) {
    throw new FlowError(`qBittorrent недоступен: ${(e as Error).message}`, 502)
  }
  const bad = all.filter(blocking)
  if (bad.length) throw new FlowError(`отказ: идут перенос или проверка файлов (${bad.map((t) => `${t.name}: ${t.state}`).slice(0, 3).join('; ')})`)
  let moving: boolean
  try {
    moving = await d.moveRunning()
  } catch {
    throw new FlowError('отказ: не удалось проверить, работает ли move-completed.sh', 502)
  }
  if (moving) throw new FlowError('отказ: работает move-completed.sh (перенос завершённой закачки) — повторите после его окончания')

  const hold = all.filter(lockHolds)
  const flow: Flow = {
    id: `${d.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    phase: 'stopping',
    torrents: hold.map((t) => ({ hash: t.hash, name: t.name, size: t.size, progress: t.progress, state: t.state })),
    startedAt: d.now(),
    finishedAt: null,
    jobId: null,
    jobStatus: null,
    jobSummary: null,
    stoppedCount: 0,
    resumedCount: null,
    resumeDeadline: null,
    error: null,
  }
  // сначала запоминаем, потом останавливаем
  save(flow)
  busyFlowId = flow.id
  try {
    const hashes = flow.torrents.map((t) => t.hash)
    await d.stopHashes(hashes)
    const deadline = d.now() + d.stopWaitMs
    for (;;) {
      const now = await d.listTorrents()
      const still = now.filter((t) => hashes.includes(t.hash) && !qbt.isStoppedState(t.state))
      if (still.length === 0) break
      if (d.now() > deadline) throw new FlowError(`торренты не остановились за ${Math.round(d.stopWaitMs / 1000)} с: ${still.map((t) => t.name).slice(0, 3).join(', ')}`)
      await d.sleep(1000)
    }
    flow.stoppedCount = hashes.length
    save(flow)
    emitEvent({ kind: 'torrents.flow', level: 'info', text: `qBittorrent: остановлено торрентов — ${hashes.length}, запускаю обновление`, target: 'qbittorrent', details: { flow: flow.id } })
    flow.jobId = await d.startJob('update', 'qbittorrent', ip)
    flow.phase = 'updating'
    save(flow)
    return flow
  } catch (e) {
    // не вышло до запуска обновления — возвращаем остановленные нами торренты
    await resumeNow(flow, d, e instanceof StartError || e instanceof FlowError ? e.message : (e as Error).message)
    if (e instanceof FlowError || e instanceof StartError) throw e
    throw new FlowError((e as Error).message, 502)
  } finally {
    busyFlowId = null
  }
}

// Быстрая попытка вернуть торренты и закрыть процесс как ошибку (когда обновление так и не началось)
async function resumeNow(flow: Flow, d: FlowDeps, reason: string) {
  try {
    const now = await d.listTorrents()
    const back = flow.torrents.map((t) => t.hash).filter((h) => now.some((t) => t.hash === h && qbt.isStoppedState(t.state)))
    await d.startHashes(back)
    flow.resumedCount = back.length
    flow.phase = 'error'
    flow.error = `обновление не начато: ${reason}; торренты возвращены (${back.length})`
  } catch (e) {
    rememberStopped(flow.torrents.map((t) => t.hash))
    flow.phase = 'error'
    flow.error = `обновление не начато: ${reason}; вернуть торренты не удалось (${(e as Error).message}) — нажмите «Запустить все»`
  }
  flow.finishedAt = d.now()
  save(flow)
  emitEvent({ kind: 'torrents.flow', level: 'warning', text: `qBittorrent: ${flow.error}`, target: 'qbittorrent', details: { flow: flow.id } })
}

let ticking = false
// Один шаг автомата. Вызывается каждые несколько секунд и при старте панели; повторяемый (идемпотентный).
export async function tickFlow(d: FlowDeps = realDeps): Promise<void> {
  const flow = getFlow()
  if (!flow || !flowActive(flow) || flow.id === busyFlowId || ticking) return
  ticking = true
  try {
    if (flow.phase === 'stopping') {
      // сюда попадаем только после перезапуска панели посреди остановки
      const job = await d.runningJob()
      if (job && job.container === 'qbittorrent' && job.startedAt >= flow.startedAt - 5000) {
        flow.jobId = job.id
        flow.phase = 'updating'
        save(flow)
      } else {
        flow.phase = 'resuming'
        flow.resumeDeadline = d.now() + d.resumeWaitMs
        flow.error = 'панель перезапускалась во время остановки торрентов — возвращаю их'
        save(flow)
      }
      return
    }
    if (flow.phase === 'updating') {
      const job = flow.jobId ? await d.getJob(flow.jobId) : null
      if (!job) {
        if (d.now() - flow.startedAt > 3 * 60_000) {
          flow.phase = 'resuming'
          flow.resumeDeadline = d.now() + d.resumeWaitMs
          flow.error = 'не найдена задача обновления — возобновляю торренты'
          save(flow)
        }
        return
      }
      if (!FINAL_JOB.includes(job.status)) return
      flow.jobStatus = job.status
      flow.jobSummary = job.summary ?? job.error
      flow.phase = 'resuming'
      flow.resumeDeadline = d.now() + d.resumeWaitMs
      save(flow)
      return
    }
    if (flow.phase === 'resuming') {
      let now: qbt.TorrentLite[]
      try {
        now = await d.listTorrents()
      } catch (e) {
        // qBittorrent ещё поднимается (или контейнер недоступен) — ждём до крайнего срока
        if (flow.resumeDeadline !== null && d.now() > flow.resumeDeadline) {
          rememberStopped(flow.torrents.map((t) => t.hash))
          flow.phase = 'error'
          flow.finishedAt = d.now()
          flow.error = `qBittorrent не отвечает (${(e as Error).message}); торренты не возобновлены — когда он поднимется, нажмите «Запустить все»`
          save(flow)
          emitEvent({ kind: 'torrents.flow', level: 'error', text: `qBittorrent: ${flow.error}`, target: 'qbittorrent', details: { flow: flow.id } })
        }
        return
      }
      const mine = new Set(flow.torrents.map((t) => t.hash))
      const stoppedNow = now.filter((t) => mine.has(t.hash) && qbt.isStoppedState(t.state))
      if (stoppedNow.length > 0 && flow.resumedCount === null) {
        await d.startHashes(stoppedNow.map((t) => t.hash))
        flow.resumedCount = stoppedNow.length // дальше проверим на следующем шаге, что они действительно запущены
        save(flow)
        return
      }
      if (stoppedNow.length > 0) {
        // уже просили запустить, но кто-то ещё остановлен: повторим, пока не истёк срок
        if (flow.resumeDeadline !== null && d.now() > flow.resumeDeadline) {
          rememberStopped(stoppedNow.map((t) => t.hash))
          flow.phase = 'error'
          flow.finishedAt = d.now()
          flow.error = `не все торренты запустились (${stoppedNow.length}) — нажмите «Запустить все»`
          save(flow)
          return
        }
        await d.startHashes(stoppedNow.map((t) => t.hash))
        return
      }
      flow.resumedCount ??= 0
      flow.phase = 'done'
      flow.finishedAt = d.now()
      save(flow)
      const ok = flow.jobStatus === 'ok'
      emitEvent({
        kind: 'torrents.flow',
        level: ok ? 'info' : 'warning',
        text: `qBittorrent: ${ok ? 'обновлён' : flow.jobStatus === 'rolledback' ? 'обновление не удалось, выполнен откат' : `обновление не удалось (${flow.jobStatus ?? 'нет данных'})`}; торрентов возобновлено: ${flow.resumedCount}`,
        target: 'qbittorrent',
        details: { flow: flow.id, job: flow.jobId, status: flow.jobStatus },
      })
    }
  } finally {
    ticking = false
  }
}

export function startFlowWatcher() {
  setTimeout(() => void tickFlow().catch(() => {}), 5000) // после перезапуска панели вернуть торренты в прежний вид
  setInterval(() => void tickFlow().catch(() => {}), 3000)
}
