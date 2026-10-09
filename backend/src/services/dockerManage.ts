// Обновление контейнеров из панели: тонкий слой над root-помощником /usr/local/sbin/server-panel-docker.
// Панель сама Docker не пишет: она (1) читает белый список и состояние задач, которые помощник кладёт в
// /etc/server-panel и /var/lib/server-panel-docker (читаются группой panel), (2) запускает помощника через sudo
// (две точные команды, deploy/sudoers-server-panel-docker). Сама работа идёт в отдельном юните systemd и не зависит от панели.
import { spawn } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { audit } from '../audit.js'
import { config } from '../config.js'
import { emitEvent } from '../events.js'
import { http } from '../http.js'
import { getSetting, setSetting } from '../settings.js'
import { invalidateUpdatesCache, refreshDockerNow } from './updates.js'

const PROJECTS = process.env.DOCKER_PROJECTS ?? '/etc/server-panel/docker-projects.json'
const STATE_DIR = process.env.DOCKER_STATE_DIR ?? '/var/lib/server-panel-docker'
const HELPER = '/usr/local/sbin/server-panel-docker'
const SUDO = '/usr/bin/sudo'

export type ManagedInfo = {
  managed: boolean
  danger: boolean
  warning: string | null
  rollbackWarning: string | null
  rollback: { version: string | null; at: number } | null
}

type Project = { danger?: boolean; warning?: string; rollback_warning?: string }

let projCache: { at: number; data: Record<string, Project> } | null = null
async function projects(): Promise<Record<string, Project>> {
  if (projCache && Date.now() - projCache.at < 5000) return projCache.data
  let data: Record<string, Project> = {}
  try {
    data = (JSON.parse(await readFile(PROJECTS, 'utf8')) as { projects?: Record<string, Project> }).projects ?? {}
  } catch {
    /* файла ещё нет (помощник не установлен) или он нечитаем — ни один контейнер не подключён */
  }
  projCache = { at: Date.now(), data }
  return data
}

type RollbackState = { rollbackImageId?: string; rollbackVersion?: string; rollbackAt?: number; lastStatus?: string }
async function rollbackState(name: string): Promise<RollbackState> {
  try {
    return JSON.parse(await readFile(`${STATE_DIR}/state/${name}.json`, 'utf8')) as RollbackState
  } catch {
    return {}
  }
}

export async function managedInfo(container: string): Promise<ManagedInfo> {
  const p = (await projects())[container]
  if (!p) return { managed: false, danger: false, warning: null, rollbackWarning: null, rollback: null }
  const st = await rollbackState(container)
  let rollback: ManagedInfo['rollback'] = null
  if (st.rollbackImageId) {
    // откат возможен, только пока сохранённый образ ещё на диске
    const ok = await http(`${config.dockerProxy}/images/${st.rollbackImageId}/json`, { timeoutMs: 4000 }).then(() => true, () => false)
    if (ok) rollback = { version: st.rollbackVersion ?? null, at: st.rollbackAt ?? 0 }
  }
  return { managed: true, danger: !!p.danger, warning: p.warning ?? null, rollbackWarning: p.rollback_warning ?? null, rollback }
}

export async function isManaged(container: string): Promise<boolean> {
  return !!(await projects())[container]
}

// ---------- задачи ----------

export type DockerJobStep = { id: string; label: string; status: 'pending' | 'running' | 'ok' | 'error' | 'skipped'; detail: string | null }
export type DockerJob = {
  id: string
  action: 'update' | 'rollback'
  container: string
  dryRun: boolean
  status: 'queued' | 'running' | 'ok' | 'error' | 'rolledback' | 'failed'
  startedAt: number
  finishedAt: number | null
  updatedAt: number
  steps: DockerJobStep[]
  from: { version: string | null; id: string } | null
  to: { version: string | null; id: string } | null
  summary: string | null
  error: string | null
}

const JOB_ID_RE = /^\d{8}-\d{6}-[0-9a-f]{6}$/
const STALE_MS = 15 * 60_000

async function jobIds(): Promise<string[]> {
  try {
    return (await readdir(`${STATE_DIR}/jobs`)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((i) => JOB_ID_RE.test(i)).sort()
  } catch {
    return []
  }
}

async function readJobFile(id: string): Promise<DockerJob | null> {
  try {
    const j = JSON.parse(await readFile(`${STATE_DIR}/jobs/${id}.json`, 'utf8')) as DockerJob
    // задача «выполняется», но помощник давно не обновлял файл — юнит убит или сервер перезагружали
    if ((j.status === 'running' || j.status === 'queued') && Date.now() - j.updatedAt > STALE_MS) j.status = 'failed'
    return j
  } catch {
    return null
  }
}

export async function getDockerJob(id: string | null, offset: number): Promise<(DockerJob & { lines: string[]; offset: number }) | null> {
  const useId = id ?? (await jobIds()).at(-1)
  if (!useId || !JOB_ID_RE.test(useId)) return null
  const job = await readJobFile(useId)
  if (!job) return null
  let lines: string[] = []
  try {
    lines = (await readFile(`${STATE_DIR}/jobs/${useId}.log`, 'utf8')).split('\n').filter(Boolean)
  } catch {
    /* журнала ещё нет */
  }
  return { ...job, lines: lines.slice(offset), offset: lines.length }
}

export async function runningDockerJob(): Promise<DockerJob | null> {
  for (const id of (await jobIds()).slice(-5).reverse()) {
    const j = await readJobFile(id)
    if (j && (j.status === 'running' || j.status === 'queued')) return j
  }
  return null
}

export class StartError extends Error {
  constructor(
    message: string,
    public statusCode = 409
  ) {
    super(message)
  }
}

// sudo -n helper update|rollback <имя>: помощник проверяет всё сам и печатает id задачи (работа идёт в юните systemd)
export function startDockerJob(action: 'update' | 'rollback', name: string, clientIp: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(SUDO, ['-n', HELPER, action, name], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (c: Buffer) => (out += c.toString('utf8')))
    child.stderr.on('data', (c: Buffer) => (err += c.toString('utf8')))
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new StartError(`не удалось запустить помощника: ${e.message}`, 500))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const id = out.trim().split('\n').at(-1) ?? ''
      if (code === 0 && JOB_ID_RE.test(id)) {
        audit({ ip: clientIp, user: 'admin', action: `docker.${action}.start`, target: name, result: 'ok', details: { job: id } })
        invalidateUpdatesCache()
        resolve(id)
      } else {
        const msg = err.trim().split('\n').at(-1)?.replace(/^отказ:\s*/, '') || 'помощник не запустил задачу'
        audit({ ip: clientIp, user: 'admin', action: `docker.${action}.start`, target: name, result: 'error', details: { error: msg } })
        reject(new StartError(msg))
      }
    })
  })
}

// ---------- итог задачи: журнал действий, событие (→ Telegram), свежие данные ----------

const REPORTED_KEY = 'updates.docker.reportedJobs'
const FINAL: DockerJob['status'][] = ['ok', 'error', 'rolledback', 'failed']

async function reportFinished(): Promise<void> {
  const reported = getSetting<string[] | null>(REPORTED_KEY, null)
  const ids = await jobIds()
  if (reported === null) {
    // первый запуск: старые задачи не пересказываем
    setSetting(REPORTED_KEY, ids)
    return
  }
  const fresh: string[] = []
  for (const id of ids.slice(-20)) {
    if (reported.includes(id)) continue
    const j = await readJobFile(id)
    if (!j || !FINAL.includes(j.status)) continue
    fresh.push(id)
    const what = j.action === 'rollback' ? 'откат' : 'обновление'
    const level = j.status === 'ok' ? 'info' : j.status === 'rolledback' ? 'warning' : 'error'
    const text =
      j.status === 'ok'
        ? `${j.dryRun ? 'Проверка' : what} контейнера ${j.container}: ${j.summary ?? 'готово'}`
        : j.status === 'rolledback'
          ? `Обновление ${j.container} не удалось, выполнен откат: ${j.error ?? ''}`
          : `${what[0].toUpperCase()}${what.slice(1)} ${j.container} не удалось: ${j.error ?? j.summary ?? ''}`
    audit({ ip: 'system', user: 'admin', action: `docker.${j.action}.finish`, target: j.container, result: j.status === 'ok' ? 'ok' : 'error', details: { job: j.id, status: j.status, summary: j.summary, error: j.error } })
    if (!j.dryRun) emitEvent({ kind: 'docker.update', level, text, target: j.container, details: { job: j.id, status: j.status, action: j.action, from: j.from?.version ?? null, to: j.to?.version ?? null, error: j.error } })
  }
  if (fresh.length) {
    setSetting(REPORTED_KEY, [...reported, ...fresh].slice(-60))
    invalidateUpdatesCache()
    void refreshDockerNow().catch(() => {})
  }
}

export function startDockerJobWatcher() {
  setTimeout(() => void reportFinished().catch(() => {}), 10_000)
  setInterval(() => void reportFinished().catch(() => {}), 5000)
}
