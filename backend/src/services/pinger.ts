// Ручной пингер (раздел «Интернет»): проверка любого адреса по запросу, история последних проверок.
// Безопасность: адрес проходит строгую проверку (IP или имя хоста, без пробелов и спецсимволов, не начинается с «-»),
// запуск — только execFile с массивом аргументов и «--» перед адресом, без shell.
import { domainToASCII } from 'node:url'
import { isIP } from 'node:net'
import { ExecError, run } from '../exec.js'
import { errText } from '../mask.js'
import { getSetting, setSetting } from '../settings.js'

export const PING_COUNTS = [1, 5, 10] as const
export type PingCount = (typeof PING_COUNTS)[number]

export type ManualPing = {
  host: string
  ip: string | null
  ts: number
  count: number
  sent: number
  received: number
  lossPct: number
  min: number | null
  avg: number | null
  max: number | null
  /** причина, если ответов нет или ping не запустился */
  error: string | null
}
export type PingHistoryItem = ManualPing & { pinned: boolean }

const HISTORY_KEY = 'internet.pinghistory'
const HISTORY_MAX = 20
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const HOSTNAME = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`)

export class PingInputError extends Error {}

// Возвращает нормализованный адрес или бросает PingInputError с понятным текстом
export function validateHost(input: unknown): string {
  if (typeof input !== 'string') throw new PingInputError('Введите адрес')
  let host = input.trim().toLowerCase().replace(/\.$/, '')
  if (!host) throw new PingInputError('Введите адрес')
  if (host.length > 253) throw new PingInputError('Слишком длинный адрес')
  if (isIP(host)) return host
  // Кириллические и другие IDN-домены переводим в punycode; всё, что после этого не похоже на имя хоста, — отказ
  if (/[^\x00-\x7f]/.test(host)) host = domainToASCII(host)
  if (!host || !HOSTNAME.test(host)) throw new PingInputError('Нужен домен (например, google.com) или IP-адрес: без пробелов, http:// и символов вроде ; | $ &')
  return host
}

function reason(stderr: string, lossPct: number): string | null {
  const s = stderr.toLowerCase()
  if (s.includes('name or service not known') || s.includes('temporary failure in name resolution') || s.includes('no address associated')) return 'имя не найдено (DNS не знает такого адреса)'
  if (s.includes('network is unreachable') || s.includes('no route to host')) return 'сеть недоступна'
  if (s.includes('operation not permitted') || s.includes('permission denied')) return 'нет прав на отправку ICMP'
  if (lossPct >= 100) return 'нет ответа: адрес не отвечает на ping (или блокирует его)'
  return null
}

function parse(host: string, count: number, stdout: string, stderr: string): ManualPing {
  const stats = stdout.match(/(\d+) packets transmitted, (\d+) (?:packets )?received(?:, \+\d+ (?:errors|duplicates))?, ([\d.]+)% packet loss/)
  const rtt = stdout.match(/= ([\d.]+)\/([\d.]+)\/([\d.]+)\//)
  const ip = stdout.match(/^PING \S+ \(([^)]+)\)/m)?.[1] ?? (isIP(host) ? host : null)
  const sent = stats ? Number(stats[1]) : 0
  const received = stats ? Number(stats[2]) : 0
  const lossPct = stats ? Number(stats[3]) : 100
  return {
    host,
    ip,
    ts: Date.now(),
    count,
    sent,
    received,
    lossPct,
    min: rtt ? Number(rtt[1]) : null,
    avg: rtt ? Number(rtt[2]) : null,
    max: rtt ? Number(rtt[3]) : null,
    error: reason(stderr, lossPct) ?? (stats ? null : 'ping не вернул статистику'),
  }
}

let busy = false
let lastAt = 0

export async function manualPing(input: unknown, countIn: unknown): Promise<ManualPing> {
  const host = validateHost(input)
  const count = (PING_COUNTS as readonly number[]).includes(Number(countIn)) ? Number(countIn) : 5
  if (busy) throw Object.assign(new Error('Проверка уже идёт — дождитесь результата'), { statusCode: 429 })
  if (Date.now() - lastAt < 1000) throw Object.assign(new Error('Не чаще одной проверки в секунду'), { statusCode: 429 })
  busy = true
  lastAt = Date.now()
  try {
    let result: ManualPing
    try {
      // -n без обратного DNS, -i 0.3 (меньше 0.2 с обычному пользователю нельзя), -W 2 — ждать ответ не дольше 2 с
      const out = await run('/usr/bin/ping', ['-n', '-c', String(count), '-i', '0.3', '-W', '2', '--', host], { timeoutMs: 20_000 })
      result = parse(host, count, out, '')
    } catch (e) {
      // ping завершается с кодом 1 при потерях и 2 при ошибках (DNS и т. п.) — статистика при этом может быть в stdout
      if (e instanceof ExecError && (e.code === 1 || e.code === 2)) result = parse(host, count, e.stdout, e.stderr)
      else throw new Error(`Не удалось запустить ping: ${errText(e)}`)
    }
    remember(result)
    return result
  } finally {
    busy = false
  }
}

export const pingHistory = (): PingHistoryItem[] => getSetting<PingHistoryItem[]>(HISTORY_KEY, [])

function remember(r: ManualPing) {
  const list = pingHistory()
  const prev = list.find((x) => x.host === r.host)
  const next = [{ ...r, pinned: prev?.pinned ?? false }, ...list.filter((x) => x.host !== r.host)]
  setSetting(HISTORY_KEY, next.slice(0, HISTORY_MAX))
}

export function forgetPing(input: unknown) {
  const host = validateHost(input)
  setSetting(HISTORY_KEY, pingHistory().filter((x) => x.host !== host))
}
