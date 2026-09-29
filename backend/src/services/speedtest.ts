// Спидтест интернета (загрузка/отдача/задержка) — по кнопке или раз в сутки по расписанию.
// Сервис: публичные тестовые адреса Cloudflare (speed.cloudflare.com/__down и /__up) — без ключей и регистрации.
// Что это значит: замер идёт до ближайшего узла Cloudflare (по anycast; в ответе приходит код узла, например KBP = Киев/Борисполь), а не до «случайного
// сервера в интернете». Результат показывает скорость канала провайдера до крупного узла, для сайтов с другой маршрутизацией она может отличаться.
// Тест занимает до ~20 секунд и расходует не более ~450 МБ трафика (лимит на загрузку 300 МБ и на отдачу 150 МБ, что наступит раньше); на это время канал занят, пинг и потери на графиках растут — это нормально.
import dns from 'node:dns/promises'
import net from 'node:net'
import { emitEvent } from '../events.js'
import { errText } from '../mask.js'
import { getSetting, setSetting } from '../settings.js'
import { lastPing } from './internet.js'

const BASE = 'https://speed.cloudflare.com'
const DOWN_STREAMS = 4
const DOWN_BYTES = 25_000_000
const DOWN_SEC = 8
const DOWN_MAX_BYTES = 300_000_000
const UP_MAX_BYTES = 150_000_000
const DOWN_WARMUP_BYTES = 20_000_000
const UP_STREAMS = 4
const UP_CHUNK = 2_000_000
const UP_SEC = 6
const MIN_INTERVAL_MS = 10 * 60_000 // Cloudflare ограничивает частоту (429 на ~час при серии тестов) — чаще раза в 10 минут не даём
const KEY = 'internet.speedtests'
const SCHED_KEY = 'internet.speedtest.schedule'

export type SpeedResult = {
  ts: number
  trigger: 'manual' | 'schedule'
  downMbps: number | null
  upMbps: number | null
  latencyMs: number | null
  jitterMs: number | null
  colo: string | null
  bytes: number
  durationSec: number
  error: string | null
}
export type SpeedSchedule = { enabled: boolean; time: string; lastDay: string | null }

let running: { startedAt: number; phase: string } | null = null

export const getSpeedSchedule = (): SpeedSchedule => ({ enabled: false, time: '04:00', lastDay: null, ...getSetting<Partial<SpeedSchedule>>(SCHED_KEY, {}) })
export function saveSpeedSchedule(s: { enabled: boolean; time: string }) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) throw Object.assign(new Error('Время должно быть в формате ЧЧ:ММ'), { statusCode: 400 })
  setSetting(SCHED_KEY, { ...getSpeedSchedule(), enabled: s.enabled, time: s.time })
}

export const speedtestState = () => ({
  running,
  results: getSetting<SpeedResult[]>(KEY, []).slice(0, 10),
  schedule: getSpeedSchedule(),
  provider: { name: 'Cloudflare (speed.cloudflare.com)', anycast: true },
})

// Ответ Cloudflare не 200 — внятная причина вместо бесконечного цикла запросов
function badResponse(res: Response, what: string): Error {
  if (res.status === 429) {
    const sec = Number(res.headers.get('retry-after'))
    return new Error(`Cloudflare временно ограничил частоту тестов${Number.isFinite(sec) && sec > 0 ? ` (повторите примерно через ${Math.ceil(sec / 60)} мин)` : ''} — это защита их сервиса от частых замеров`)
  }
  return new Error(`${what}: сервер ответил ${res.status}`)
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d

// Задержка — время TCP-рукопожатия до узла (чистый RTT, без времени обработки на стороне сервера)
function tcpRtt(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now()
    const s = net.connect({ host, port: 443, timeout: 4000 })
    s.once('connect', () => (s.destroy(), resolve(performance.now() - t0)))
    s.once('timeout', () => (s.destroy(), reject(new Error('задержка: нет ответа'))))
    s.once('error', (e) => reject(e))
  })
}

async function latency(): Promise<{ latencyMs: number | null; jitterMs: number | null; colo: string | null }> {
  const t: number[] = []
  // имя резолвим один раз: DNS-сервер (AdGuard) ограничивает частоту запросов, серия из 10 подключений по имени упирается в лимит
  const { address } = await dns.lookup('speed.cloudflare.com', { family: 4 })
  for (let i = 0; i < 10; i++) t.push(await tcpRtt(address))
  const sorted = [...t].sort((a, b) => a - b)
  const jitter = t.slice(1).reduce((s, v, i) => s + Math.abs(v - t[i]), 0) / (t.length - 1)
  // код узла Cloudflare (KBP = Киев/Борисполь) — из заголовка ответа
  const res = await fetch(`${BASE}/__down?bytes=0`, { signal: AbortSignal.timeout(5000) })
  await res.arrayBuffer()
  return { latencyMs: round(sorted[Math.floor(sorted.length / 2)]), jitterMs: round(jitter), colo: res.headers.get('colo') ?? res.headers.get('cf-meta-colo') }
}

async function download(): Promise<{ mbps: number; bytes: number }> {
  const ac = new AbortController()
  let total = 0
  let startAt: number | null = null // момент, когда набрано DOWN_WARMUP_BYTES (разгон TCP не считаем)
  let startTotal = 0
  let lastAt = 0
  const timer = setTimeout(() => ac.abort(), DOWN_SEC * 1000)
  const worker = async () => {
    while (!ac.signal.aborted) {
      const res = await fetch(`${BASE}/__down?bytes=${DOWN_BYTES}`, { signal: ac.signal })
      if (!res.ok) throw badResponse(res, 'загрузка')
      const reader = res.body!.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.length
        lastAt = performance.now()
        if (startAt === null && total >= DOWN_WARMUP_BYTES) {
          startAt = lastAt
          startTotal = total
        }
        if (total >= DOWN_MAX_BYTES) ac.abort()
      }
    }
  }
  await Promise.all(Array.from({ length: DOWN_STREAMS }, () => worker().catch((e) => (ac.signal.aborted ? undefined : Promise.reject(e)))))
  clearTimeout(timer)
  if (startAt === null || lastAt <= startAt || total <= startTotal) throw new Error('загрузка: данных получено слишком мало для замера')
  return { mbps: round(((total - startTotal) * 8) / ((lastAt - startAt) / 1000) / 1e6), bytes: total }
}

async function upload(): Promise<{ mbps: number; bytes: number }> {
  const body = Buffer.alloc(UP_CHUNK)
  const t0 = performance.now()
  let sent = 0
  const worker = async () => {
    while ((performance.now() - t0) / 1000 < UP_SEC && sent < UP_MAX_BYTES) {
      const res = await fetch(`${BASE}/__up`, { method: 'POST', body, signal: AbortSignal.timeout(15_000), headers: { 'content-type': 'application/octet-stream' } })
      await res.arrayBuffer()
      if (!res.ok) throw badResponse(res, 'отдача')
      sent += UP_CHUNK
    }
  }
  await Promise.all(Array.from({ length: UP_STREAMS }, worker))
  const sec = (performance.now() - t0) / 1000
  if (!sent) throw new Error('отдача: данные не отправлены')
  return { mbps: round((sent * 8) / sec / 1e6), bytes: sent }
}

// Можно ли запустить тест сейчас (бросает ошибку с понятным текстом); вызывается и из маршрута — до ответа 202
export function checkSpeedtestAllowed(trigger: SpeedResult['trigger']) {
  if (running) throw Object.assign(new Error('Тест уже идёт'), { statusCode: 409 })
  const prev = getSetting<SpeedResult[]>(KEY, [])[0]
  if (prev && !prev.error && Date.now() - prev.ts < MIN_INTERVAL_MS && trigger === 'manual')
    throw Object.assign(new Error(`Слишком часто: следующий замер можно запустить примерно через ${Math.ceil((MIN_INTERVAL_MS - (Date.now() - prev.ts)) / 60_000)} мин`), { statusCode: 429 })
  if (lastPing() && !lastPing()!.online) throw Object.assign(new Error('Нет связи с интернетом — тест невозможен'), { statusCode: 400 })
}

export async function runSpeedtest(trigger: SpeedResult['trigger']): Promise<SpeedResult> {
  checkSpeedtestAllowed(trigger)
  const started = Date.now()
  running = { startedAt: started, phase: 'задержка' }
  const r: SpeedResult = { ts: started, trigger, downMbps: null, upMbps: null, latencyMs: null, jitterMs: null, colo: null, bytes: 0, durationSec: 0, error: null }
  try {
    Object.assign(r, await latency())
    running.phase = 'загрузка (приём)'
    const d = await download()
    r.downMbps = d.mbps
    r.bytes += d.bytes
    running.phase = 'отдача'
    const u = await upload()
    r.upMbps = u.mbps
    r.bytes += u.bytes
  } catch (e) {
    r.error = errText(e)
  } finally {
    r.durationSec = Math.round((Date.now() - started) / 1000)
    running = null
    setSetting(KEY, [r, ...getSetting<SpeedResult[]>(KEY, [])].slice(0, 30))
  }
  if (!r.error) emitEvent({ kind: 'internet.speedtest', level: 'info', text: `Спидтест: ↓ ${r.downMbps} Мбит/с, ↑ ${r.upMbps} Мбит/с, пинг ${r.latencyMs} мс`, target: 'internet', details: r })
  return r
}

// Расписание: раз в сутки после заданного времени, один раз за день (если панель была выключена — выполнится при следующей проверке того же дня)
export function startSpeedtest() {
  setInterval(() => {
    const s = getSpeedSchedule()
    if (!s.enabled || running) return
    const now = new Date()
    const day = now.toLocaleDateString('sv-SE')
    const hhmm = now.toTimeString().slice(0, 5)
    if (s.lastDay === day || hhmm < s.time) return
    setSetting(SCHED_KEY, { ...s, lastDay: day })
    void runSpeedtest('schedule').catch(() => {})
  }, 60_000)
}
