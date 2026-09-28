// Обменник файлов (SFTPGo в Docker, /srv/exchange): состояние для карточки и уведомления о загрузках.
// Загрузки берём из журнала контейнера: на уровне info SFTPGo пишет событие «Upload» с пользователем,
// путём, размером и настоящим IP (за nginx он передаётся заголовком X-Forwarded-For). Секреты и админка не нужны.
import type { FastifyBaseLogger } from 'fastify'
import { readFsUsage } from '../collector/sources.js'
import { config } from '../config.js'
import { emitEvent } from '../events.js'
import { run } from '../exec.js'
import { http } from '../http.js'
import { isAllowed } from '../net.js'
import { getSetting, setSetting } from '../settings.js'
import * as docker from './docker.js'

const CONTAINER = 'sftpgo'
const DIR = '/srv/exchange'
const GUEST = 'uploads' // файловый пользователь-гость: уведомляем только о его загрузках
export const EXCHANGE_URLS = {
  external: 'https://api.pulsdev.net:9443/files/',
  home: 'https://api.pulsdev.net/files/',
  admin: 'https://api.pulsdev.net:8443/files/web/admin/',
}

export type UploadRecord = { ts: number; user: string; ip: string; name: string; size: number }

const RECENT_KEY = 'exchange.uploads'
const SINCE_KEY = 'exchange.logSince'

const cleanName = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120)
const stripPort = (a: string) => (a.startsWith('[') ? a.replace(/^\[([^\]]+)\].*$/, '$1') : a.replace(/:\d+$/, ''))

export function fmtSize(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} ГБ`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1).replace('.', ',')} МБ`
  if (n >= 1024) return `${Math.round(n / 1024)} КБ`
  return `${n} Б`
}

// Разбор одной строки журнала SFTPGo → загрузка (или null)
export function parseUploadLine(text: string): Omit<UploadRecord, 'ts'> | null {
  if (!/"sender"\s*:\s*"Upload"/.test(text)) return null
  try {
    const j = JSON.parse(text) as { sender?: string; username?: string; remote_addr?: string; size_bytes?: number; virtual_path?: string }
    if (j.sender !== 'Upload' || !j.username || !j.virtual_path) return null
    return { user: j.username, ip: stripPort(j.remote_addr ?? ''), name: cleanName(j.virtual_path.replace(/^\//, '')), size: Number(j.size_bytes) || 0 }
  } catch {
    return null
  }
}

let busy = false
export async function pollUploads() {
  if (busy) return
  busy = true
  try {
    const now = Date.now()
    const since = getSetting<number | null>(SINCE_KEY, null)
    if (since === null) {
      setSetting(SINCE_KEY, now) // первый запуск: старые загрузки не пересылаем
      return
    }
    const lines = await docker.containerLogs(CONTAINER, 0, Math.floor(since / 1000))
    let last = since
    const found: UploadRecord[] = []
    for (const l of lines) {
      if (l.ts === null || l.ts <= since) continue
      last = Math.max(last, l.ts)
      const u = parseUploadLine(l.text)
      if (u) found.push({ ts: l.ts, ...u })
    }
    if (last !== since) setSetting(SINCE_KEY, last)
    if (!found.length) return
    setSetting(RECENT_KEY, [...found.reverse(), ...getSetting<UploadRecord[]>(RECENT_KEY, [])].slice(0, 40))

    // Уведомления — только о гостевых загрузках, группой на каждый IP за опрос
    const byIp = new Map<string, UploadRecord[]>()
    for (const u of found.filter((f) => f.user === GUEST)) byIp.set(u.ip, [...(byIp.get(u.ip) ?? []), u])
    for (const [ip, list] of byIp) {
      const total = list.reduce((s, x) => s + x.size, 0)
      const where = ip ? `IP ${ip}${isAllowed(ip, config.allowedNets) ? ' (домашняя сеть или VPN)' : ''}` : 'IP неизвестен'
      const names = [...list].reverse().map((x) => `«${x.name}»`)
      const text =
        list.length === 1
          ? `Гость загрузил файл ${names[0]} (${fmtSize(total)}) — ${where}`
          : `Гость загрузил файлов: ${list.length} (${fmtSize(total)}) — ${where}: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` и ещё ${names.length - 5}` : ''}`
      emitEvent({ kind: 'exchange.upload', level: 'info', text, target: 'exchange', details: { ip, user: GUEST, files: list.map((x) => ({ name: x.name, size: x.size })), total } })
    }
  } finally {
    busy = false
  }
}

// du по каталогу обменника — медленно, поэтому в фоне и с кэшем
const sizes = new Map<string, { at: number; value: number | null }>()
const sizeBusy = new Set<string>()
function dirSize(path: string): number | null {
  const c = sizes.get(path)
  if (!c || Date.now() - c.at > 10 * 60_000) {
    if (!sizeBusy.has(path)) {
      sizeBusy.add(path)
      run('/usr/bin/du', ['-sb', path], { timeoutMs: 60_000 })
        .catch((e) => (e.stdout as string) ?? '')
        .then((out) => sizes.set(path, { at: Date.now(), value: Number(out.split('\t')[0]) || null }))
        .finally(() => sizeBusy.delete(path))
    }
  }
  return c?.value ?? null
}

export async function exchangeState() {
  const container = await docker.getContainer(CONTAINER).catch(() => null)
  let health: { ok: boolean; ms: number } | null = null
  const t0 = performance.now()
  health = await http('http://127.0.0.1:8080/healthz', { timeoutMs: 3000 })
    .then(() => ({ ok: true, ms: Math.round(performance.now() - t0) }))
    .catch(() => ({ ok: false, ms: 0 }))
  const dirOk = await run('/usr/bin/test', ['-d', DIR]).then(() => true).catch(() => false)
  const fs = dirOk ? await readFsUsage(DIR).catch(() => null) : null
  return {
    installed: Boolean(container),
    container: container ? { state: container.state, status: container.status ?? null } : null,
    health,
    urls: EXCHANGE_URLS,
    disk: dirOk ? { fs, exchangeBytes: dirSize(DIR), uploadsBytes: dirSize(`${DIR}/uploads`) } : null,
    recent: getSetting<UploadRecord[]>(RECENT_KEY, []).slice(0, 15),
    guest: GUEST,
  }
}

export function startExchange(log: FastifyBaseLogger) {
  setInterval(() => void pollUploads().catch((e) => log.debug({ err: (e as Error).message }, 'обменник: опрос журнала')), 30_000)
}
