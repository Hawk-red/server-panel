// Детекторы системных событий: раз в минуту сравнивают состояние с прошлым и пишут изменения в events.
// Первый прогон только запоминает состояние (без событий), чтобы перезапуск панели не давал ложных записей.
import { open, stat } from 'node:fs/promises'
import type { FastifyBaseLogger } from 'fastify'
import { getSnapshot } from './collector/index.js'
import { emitEvent, pruneEvents } from './events.js'
import { percentLevel } from './levels.js'
import { listContainers } from './services/docker.js'
import { lastSync } from './services/sites.js'
import { failedUnits } from './system/units.js'

let log: FastifyBaseLogger | undefined
const state = {
  failed: null as Set<string> | null,
  disks: null as Map<string, string> | null,
  containers: null as Map<string, { state: string; startedAt: number | null }> | null,
  f2b: null as { ino: number; pos: number } | null,
  syncStarted: null as number | null | undefined,
}

async function units() {
  const now = new Set(await failedUnits())
  const prev = state.failed
  state.failed = now
  if (!prev) return
  for (const u of now) if (!prev.has(u)) emitEvent({ kind: 'unit.failed', level: 'error', text: `Служба ${u} упала`, target: u })
  for (const u of prev) if (!now.has(u)) emitEvent({ kind: 'unit.recovered', level: 'info', text: `Служба ${u} снова работает (или сброшена)`, target: u })
}

async function disks() {
  const snap = getSnapshot()
  if (!snap?.disks) return
  const now = new Map<string, string>()
  for (const d of snap.disks) {
    if (!d.mount) continue
    now.set(d.mount, d.state === 'missing' ? 'missing' : d.percent == null ? 'unknown' : (percentLevel(d.percent, 'higher-worse') ?? 'ok'))
  }
  const prev = state.disks
  state.disks = now
  if (!prev) return
  for (const [mount, lvl] of now) {
    const was = prev.get(mount)
    if (!was || was === lvl || lvl === 'unknown') continue
    const d = snap.disks.find((x) => x.mount === mount)
    const pct = d?.percent != null ? `${Math.round(d.percent)}%` : ''
    if (lvl === 'missing') emitEvent({ kind: 'disk.missing', level: 'error', text: `Диск ${mount} отвалился (нет в системе)`, target: mount })
    else if (was === 'missing') emitEvent({ kind: 'disk.back', level: 'info', text: `Диск ${mount} снова подключён`, target: mount })
    else if (lvl === 'danger') emitEvent({ kind: 'disk.threshold', level: 'error', text: `Диск ${mount} заполнен на ${pct} — выше 85%`, target: mount })
    else if (lvl === 'warn') emitEvent({ kind: 'disk.threshold', level: 'warning', text: `Диск ${mount}: ${pct} — перешёл порог 70%`, target: mount })
    else emitEvent({ kind: 'disk.threshold', level: 'info', text: `Диск ${mount}: ${pct} — снова ниже 70%`, target: mount })
  }
}

async function containers() {
  const list = await listContainers(false)
  const now = new Map(list.map((c) => [c.name, { state: c.state, startedAt: c.startedAt }]))
  const prev = state.containers
  state.containers = now
  if (!prev) return
  for (const [name, c] of now) {
    const p = prev.get(name)
    if (!p) continue
    if (p.state === 'running' && c.state !== 'running')
      emitEvent({ kind: 'container.stopped', level: 'error', text: `Контейнер ${name} остановился (${c.state})`, target: name })
    else if (c.state === 'running' && p.state !== 'running') emitEvent({ kind: 'container.started', level: 'info', text: `Контейнер ${name} запущен`, target: name })
    else if (c.state === 'running' && p.startedAt && c.startedAt && c.startedAt !== p.startedAt)
      emitEvent({ kind: 'container.restart', level: 'warning', text: `Контейнер ${name} перезапустился`, target: name })
  }
}

// fail2ban.log читаем по приращению (с учётом ротации по inode)
async function fail2ban() {
  const file = '/var/log/fail2ban.log'
  const st = await stat(file)
  const prev = state.f2b
  if (!prev || prev.ino !== st.ino || st.size < prev.pos) {
    state.f2b = { ino: st.ino, pos: prev && prev.ino !== st.ino ? 0 : st.size }
    if (!prev) return
  }
  const cur = state.f2b!
  if (st.size <= cur.pos) return
  const fh = await open(file, 'r')
  try {
    const len = Math.min(st.size - cur.pos, 1024 * 1024)
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, cur.pos)
    cur.pos += len
    for (const line of buf.toString('utf8').split('\n')) {
      const m = line.match(/\[(\S+)\]\s+Ban\s+(\S+)/)
      if (m) emitEvent({ kind: 'f2b.ban', level: 'warning', text: `fail2ban (${m[1]}) забанил ${m[2]}`, target: m[2] })
    }
  } finally {
    await fh.close()
  }
}

async function sync() {
  const s = await lastSync()
  if (!s || !s.finished) return
  if (state.syncStarted === undefined) {
    state.syncStarted = s.started
    return
  }
  if (s.started === state.syncStarted) return
  state.syncStarted = s.started
  if (s.status === 'ok') emitEvent({ kind: 'sync.ok', level: 'info', text: 'Ночной синк jetsetter завершён успешно' })
  else emitEvent({ kind: 'sync.error', level: 'warning', text: `Ночной синк jetsetter завершён с предупреждениями (${s.errors.length})`, details: { errors: s.errors.slice(-5) } })
}

async function tick() {
  for (const [name, fn] of Object.entries({ units, disks, containers, fail2ban, sync })) {
    try {
      await fn()
    } catch (e) {
      log?.debug({ detector: name, err: (e as Error).message }, 'детектор событий: пропуск')
    }
  }
}

export function startDetectors(logger: FastifyBaseLogger) {
  log = logger
  state.syncStarted = undefined
  const run = () => void tick()
  setTimeout(run, 20_000) // после первого снимка коллектора
  setInterval(run, 60_000)
  setInterval(pruneEvents, 24 * 3600_000)
}
