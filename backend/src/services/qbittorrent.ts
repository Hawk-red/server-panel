// qBittorrent Web API v2 (5.x: pause/resume → torrents/stop|start)
import { readFile } from 'node:fs/promises'
import { config } from '../config.js'
import { readFsUsage } from '../collector/sources.js'
import { http, HttpError } from '../http.js'

let sid: string | null = null

export class NotConfigured extends Error {}

async function login() {
  if (!config.qbt.user || !config.qbt.password) throw new NotConfigured('не заданы QBT_USER/QBT_PASSWORD')
  const res = await http(`${config.qbt.url}/api/v2/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', Referer: config.qbt.url },
    body: new URLSearchParams({ username: config.qbt.user, password: config.qbt.password }),
  })
  const text = (await res.text()).trim()
  // 4.x: 200 «Ok.» + cookie SID; 5.x: 204 без тела + cookie QBT_SID_<порт>
  const cookie = res.headers.get('set-cookie')?.match(/((?:QBT_)?SID(?:_\d+)?)=([^;]+)/)
  if ((text !== '' && text !== 'Ok.') || !cookie) throw new Error('qBittorrent отклонил логин')
  sid = `${cookie[1]}=${cookie[2]}`
}

async function call(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  if (!sid) await login()
  try {
    return await http(`${config.qbt.url}/api/v2${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Cookie: sid!, Referer: config.qbt.url },
    })
  } catch (e) {
    if (retry && e instanceof HttpError && (e.status === 403 || e.status === 401)) {
      sid = null
      return call(path, init, false)
    }
    throw e
  }
}

const json = async <T>(path: string) => (await call(path)).json() as Promise<T>

type Torrent = {
  hash: string
  name: string
  progress: number
  dlspeed: number
  upspeed: number
  num_seeds: number
  num_complete: number
  num_leechs: number
  num_incomplete: number
  eta: number
  size: number
  state: string
  ratio: number
}

const DOWNLOADING = new Set(['downloading', 'forcedDL', 'metaDL', 'forcedMetaDL', 'stalledDL', 'queuedDL', 'checkingDL', 'allocating'])
const SEEDING = new Set(['uploading', 'forcedUP', 'stalledUP', 'queuedUP', 'checkingUP'])

export async function transferSpeed() {
  const t = await json<{ dl_info_speed: number; up_info_speed: number }>('/transfer/info')
  return { dl: t.dl_info_speed, ul: t.up_info_speed }
}

export async function summary() {
  const [version, transfer, main, torrents] = await Promise.all([
    call('/app/version').then((r) => r.text()),
    json<{ dl_info_speed: number; up_info_speed: number; dl_info_data: number; up_info_data: number; connection_status: string }>('/transfer/info'),
    json<{ server_state: { alltime_dl: number; alltime_ul: number; global_ratio: string } }>('/sync/maindata?rid=0'),
    json<Torrent[]>('/torrents/info'),
  ])
  const active = torrents.filter((t) => t.dlspeed > 0 || t.upspeed > 0 || t.state === 'downloading' || t.state === 'metaDL')
  return {
    version: version.trim(),
    connection: transfer.connection_status,
    speed: { dl: transfer.dl_info_speed, ul: transfer.up_info_speed },
    session: { dl: transfer.dl_info_data, ul: transfer.up_info_data },
    alltime: { dl: main.server_state.alltime_dl, ul: main.server_state.alltime_ul, ratio: Number(main.server_state.global_ratio) },
    counts: {
      total: torrents.length,
      downloading: torrents.filter((t) => DOWNLOADING.has(t.state)).length,
      seeding: torrents.filter((t) => SEEDING.has(t.state)).length,
      stopped: torrents.filter((t) => /^(stopped|paused)/.test(t.state)).length,
      errored: torrents.filter((t) => t.state === 'error' || t.state === 'missingFiles').length,
    },
    active: active
      .sort((a, b) => b.dlspeed + b.upspeed - (a.dlspeed + a.upspeed))
      .slice(0, 50)
      .map((t) => ({
        hash: t.hash,
        name: t.name,
        progress: t.progress,
        dlspeed: t.dlspeed,
        upspeed: t.upspeed,
        seeds: t.num_seeds,
        seedsTotal: t.num_complete,
        peers: t.num_leechs,
        peersTotal: t.num_incomplete,
        eta: t.eta >= 8640000 ? null : t.eta,
        size: t.size,
        state: t.state,
      })),
  }
}

// Для «Быстрых действий»: все ли торренты на паузе
export async function pauseState() {
  const all = await json<Torrent[]>('/torrents/info')
  const stopped = all.filter((t) => /^(stopped|paused)/.test(t.state)).length
  return { total: all.length, stopped, running: all.length - stopped, allStopped: all.length > 0 && stopped === all.length }
}

export async function stopAll() {
  await call('/torrents/stop', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'hashes=all' })
}
export async function startAll() {
  await call('/torrents/start', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'hashes=all' })
}

// Состояние torrent-space-guard.sh: какой диск он проверяет, пороги, последняя пауза.
// Секреты из скрипта не читаются наружу — берём только LOW_GB/RESUME_GB и путь df.
export async function spaceGuard() {
  const script = await readFile('/home/hawk/scripts/torrent-space-guard.sh', 'utf8').catch(() => null)
  const num = (re: RegExp) => {
    const v = Number(script?.match(re)?.[1] ?? NaN)
    return Number.isFinite(v) ? v : null
  }
  const watchedPath = script?.match(/df\s+--output=avail\s+(\S+)/)?.[1] ?? null
  const watched = watchedPath ? await readFsUsage(watchedPath).catch(() => null) : null
  const downloads = await readFsUsage(config.torrentsDir).catch(() => null)
  const log = await readFile('/var/log/torrent-move.log', 'utf8').catch(() => null)
  const lines = log?.split('\n').filter(Boolean) ?? []
  const lastPause = [...lines].reverse().find((l) => /paused/i.test(l)) ?? null
  const ts = lastPause?.match(/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/)?.[1]
  return {
    scriptReadable: script !== null,
    thresholdGb: num(/^\s*LOW_GB=(\d+)/m),
    resumeGb: num(/^\s*RESUME_GB=(\d+)/m),
    watchedPath,
    watchedFree: watched?.free ?? null,
    downloadsPath: config.torrentsDir,
    downloadsFree: downloads?.free ?? null,
    downloadsTotal: downloads?.total ?? null,
    // Скрипт следит не за тем диском, куда качается?
    mismatch: Boolean(watchedPath && !config.torrentsDir.startsWith(watchedPath) && watched && downloads && watched.total !== downloads.total),
    lastPause: lastPause ? { at: ts ? Date.parse(ts.replace(' ', 'T')) : null, text: lastPause } : null,
  }
}
