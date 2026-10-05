// Установка обновлений apt из раздела «Обновления»: одна задача за раз, вывод стримится построчно.
// Запуск — только через узкую root-утилиту /usr/local/sbin/server-panel-apt (sudo, deploy/sudoers-server-panel).
import { spawn } from 'node:child_process'
import { audit } from '../audit.js'
import { refreshUpdates } from './updates.js'

export type AptMode = 'selected' | 'all'
export type AptJob = {
  id: string
  mode: AptMode
  packages: string[]
  status: 'running' | 'ok' | 'error'
  exitCode: number | null
  startedAt: number
  finishedAt: number | null
  lines: string[]
  truncated: boolean
}

const MAX_LINES = 5000
const SUDO = '/usr/bin/sudo'
const UTIL = '/usr/local/sbin/server-panel-apt'

let current: AptJob | null = null

export function getAptJob(): AptJob | null {
  return current
}

export function startAptJob(mode: AptMode, packages: string[], clientIp: string): AptJob {
  if (current?.status === 'running') throw new Error('обновление уже идёт, дождитесь окончания')
  const job: AptJob = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    mode,
    packages,
    status: 'running',
    exitCode: null,
    startedAt: Date.now(),
    finishedAt: null,
    lines: [],
    truncated: false,
  }
  current = job

  const child = spawn(SUDO, ['-n', UTIL, mode === 'all' ? 'upgrade-all' : 'upgrade-selected'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, LC_ALL: 'C', DEBIAN_FRONTEND: 'noninteractive' },
  })
  // Список пакетов — через stdin: в командной строке его не видно в ps
  child.stdin.end(mode === 'selected' ? `${packages.join('\n')}\n` : '')

  const pending: Record<'out' | 'err', string> = { out: '', err: '' }
  const push = (text: string) => {
    if (job.lines.length >= MAX_LINES) {
      job.truncated = true
      return
    }
    job.lines.push(text)
  }
  const feed = (kind: 'out' | 'err', chunk: Buffer) => {
    const parts = (pending[kind] + chunk.toString('utf8')).split(/\r?\n|\r/)
    pending[kind] = parts.pop() ?? ''
    for (const p of parts) if (p.trim()) push(p)
  }
  child.stdout.on('data', (c: Buffer) => feed('out', c))
  child.stderr.on('data', (c: Buffer) => feed('err', c))

  const finish = (code: number | null, error?: string) => {
    if (pending.out.trim()) push(pending.out)
    if (pending.err.trim()) push(pending.err)
    if (error) push(`ошибка запуска: ${error}`)
    job.status = code === 0 ? 'ok' : 'error'
    job.exitCode = code
    job.finishedAt = Date.now()
    audit({
      ip: clientIp,
      user: 'admin',
      action: mode === 'all' ? 'apt.upgrade.all' : 'apt.upgrade.selected',
      target: mode === 'all' ? 'все обновления' : job.packages.join(', '),
      result: code === 0 ? 'ok' : 'error',
      details: { exitCode: code, packages: job.packages.length, ...(error ? { error } : {}) },
    })
    // Список обновлений и флаг перезагрузки — свежие после установки
    void refreshUpdates(true).catch(() => {})
  }
  child.on('close', (code) => finish(code))
  child.on('error', (e) => finish(null, e.message))

  return job
}

// Срез строк начиная с offset: клиент опрашивает и получает только новое
export function jobSlice(job: AptJob, offset: number) {
  return { lines: job.lines.slice(offset), total: job.lines.length, truncated: job.truncated }
}
