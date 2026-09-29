// Интернет (этап 10.5): пинг до 1.1.1.1 (основной) и 8.8.8.8 (проверка «это мы или он»), внешний IP, обрывы связи.
// «Интернета нет» — только когда не отвечают ОБА адреса (один недоступный узел — не обрыв).
// Уведомление об обрыве > 5 минут уходит уже после восстановления связи: пока интернета нет, Telegram недоступен.
import { Resolver } from 'node:dns/promises'
import net from 'node:net'
import { db } from '../db.js'
import { emitEvent } from '../events.js'
import { ExecError, run } from '../exec.js'
import { http } from '../http.js'
import { getSetting, setSetting } from '../settings.js'

export const PING_MAIN = '1.1.1.1'
export const PING_SECOND = '8.8.8.8'
export const PING_ROUTER = '192.168.31.1'
export const PING_PROD = '148.251.76.118'
export const DNS_LOCAL = '127.0.0.1' // AdGuard Home
export const OUTAGE_NOTIFY_SEC = 300 // обрыв длиннее — уведомление
export const OUTAGE_RECORD_SEC = 60 // обрыв длиннее — запись в историю

type Outage = { from: number; to: number; sec: number }
type State = { downSince: number | null; downEventSent: boolean; lastSeen: number | null }
type IpInfo = { ip: string; since: number; checkedAt: number }

const STATE_KEY = 'internet.state'
const OUTAGES_KEY = 'internet.outages'
const IP_KEY = 'internet.ip'

// Дополнительные цели (только для диагностики, на определение «обрыва» не влияют)
export type ExtraPing = { router: number | null; prod: number | null; adguard: number | null }
export type PingResult = { ts: number; main: number | null; second: number | null; online: boolean; extra: ExtraPing }
let last: PingResult | null = null

function tcpPing(host: string, port = 443, timeoutMs = 2500): Promise<number | null> {
  return new Promise((resolve) => {
    const t0 = performance.now()
    const s = net.connect({ host, port, timeout: timeoutMs })
    s.once('connect', () => {
      s.destroy()
      resolve(Math.round((performance.now() - t0) * 10) / 10)
    })
    s.once('timeout', () => (s.destroy(), resolve(null)))
    s.once('error', () => resolve(null))
  })
}

// ICMP через системный ping (cap_net_raw есть у /usr/bin/ping); если ping недоступен — TCP-рукопожатие на 443
async function ping(host: string): Promise<number | null> {
  try {
    const out = await run('/usr/bin/ping', ['-n', '-c', '1', '-W', '2', host], { timeoutMs: 5000 })
    const ms = Number(out.match(/time[=<]([\d.]+)/)?.[1])
    return Number.isFinite(ms) ? ms : null
  } catch (e) {
    const err = e as ExecError
    // код 1 — ответа нет (обычная потеря); прочее (нет бинарника/прав/сети) — пробуем TCP
    if (err.code === 1) return null
    if (/unreachable|resolution/i.test(err.stderr ?? '')) return null
    return tcpPing(host)
  }
}

// Время ответа AdGuard на DNS-запрос (чаще всего из кэша — показывает «жив ли DNS», а не скорость апстрима)
async function dnsPing(): Promise<number | null> {
  const r = new Resolver({ timeout: 2000, tries: 1 })
  r.setServers([DNS_LOCAL])
  const t0 = performance.now()
  try {
    await r.resolve4('cloudflare.com')
    return Math.round((performance.now() - t0) * 10) / 10
  } catch {
    return null
  }
}

export const lastPing = () => last

const getState = () => getSetting<State>(STATE_KEY, { downSince: null, downEventSent: false, lastSeen: null })

const fmtTime = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
export function fmtDur(sec: number) {
  if (sec < 90) return `${sec} с`
  const m = Math.round(sec / 60)
  if (m < 90) return `${m} мин`
  const h = Math.floor(m / 60)
  return `${h} ч ${m % 60} мин`
}

// Один замер: пинг + автомат «обрыв связи». Возвращает значения для записи в метрики.
export async function checkInternet(now = Date.now()): Promise<Record<string, number>> {
  const [main, second, router, prod, adguard] = await Promise.all([ping(PING_MAIN), ping(PING_SECOND), ping(PING_ROUTER), ping(PING_PROD), dnsPing()])
  const online = main !== null || second !== null
  last = { ts: now, main, second, online, extra: { router, prod, adguard } }

  const st = getState()
  // Панель (или сервер) была выключена: что происходило с интернетом в это время — неизвестно
  if (st.downSince && st.lastSeen && now - st.lastSeen > 120_000) {
    st.downSince = null
    st.downEventSent = false
  }
  if (!online) {
    if (!st.downSince) {
      st.downSince = now
      st.downEventSent = false
    } else if (!st.downEventSent && now - st.downSince >= OUTAGE_NOTIFY_SEC * 1000) {
      st.downEventSent = true
      emitEvent({ kind: 'internet.down', level: 'error', text: `Интернета нет уже более ${OUTAGE_NOTIFY_SEC / 60} минут (с ${fmtTime(st.downSince)})`, target: 'internet' })
    }
  } else if (st.downSince) {
    const sec = Math.round((now - st.downSince) / 1000)
    if (sec >= OUTAGE_RECORD_SEC) {
      const outage: Outage = { from: st.downSince, to: now, sec }
      setSetting(OUTAGES_KEY, [outage, ...getSetting<Outage[]>(OUTAGES_KEY, [])].slice(0, 30))
      emitEvent({
        kind: 'internet.outage',
        level: sec >= OUTAGE_NOTIFY_SEC ? 'warning' : 'info',
        text: `Интернета не было ${fmtDur(sec)} (с ${fmtTime(outage.from)} до ${fmtTime(outage.to)})`,
        target: 'internet',
        details: outage,
        ts: now,
      })
    }
    st.downSince = null
    st.downEventSent = false
    void refreshExternalIp(true).catch(() => {})
  }
  st.lastSeen = now
  setSetting(STATE_KEY, st)

  // loss: 1 — основной адрес не ответил (в 5-минутных средних получается доля потерь)
  const values: Record<string, number> = { 'inet.loss': main === null ? 1 : 0 }
  if (main !== null) values['inet.ping_ms'] = main
  if (second !== null) values['inet.second_ms'] = second
  if (router !== null) values['inet.router_ms'] = router
  if (prod !== null) values['inet.prod_ms'] = prod
  if (adguard !== null) values['inet.adguard_ms'] = adguard
  return values
}

// Внешний IP: ipify, запасной — icanhazip. Раз в 10 минут и после восстановления связи. Смена IP → событие.
let ipAt = 0
export async function refreshExternalIp(force = false) {
  if (!force && Date.now() - ipAt < 600_000) return
  ipAt = Date.now()
  let ip: string | null = null
  for (const url of ['https://api.ipify.org', 'https://icanhazip.com']) {
    try {
      const t = (await (await http(url, { timeoutMs: 6000 })).text()).trim()
      if (/^(\d{1,3}\.){3}\d{1,3}$/.test(t)) {
        ip = t
        break
      }
    } catch {
      /* пробуем следующий */
    }
  }
  if (!ip) return
  const prev = getSetting<IpInfo | null>(IP_KEY, null)
  if (!prev || prev.ip !== ip) {
    setSetting(IP_KEY, { ip, since: Date.now(), checkedAt: Date.now() } satisfies IpInfo)
    if (prev) emitEvent({ kind: 'internet.ip', level: 'warning', text: `Внешний IP изменился: ${prev.ip} → ${ip}`, target: 'internet', details: { from: prev.ip, to: ip } })
  } else setSetting(IP_KEY, { ...prev, checkedAt: Date.now() })
}

function statsSince(table: 'metric_raw' | 'metric_5m', from: number) {
  const col = table === 'metric_raw' ? 'value' : 'avg'
  const max = table === 'metric_raw' ? 'value' : 'max'
  const ms = db.prepare(`SELECT AVG(${col}) AS a, MAX(${max}) AS m, COUNT(*) AS n FROM ${table} WHERE name = 'inet.ping_ms' AND ts >= ?`).get(from) as { a: number | null; m: number | null; n: number }
  const loss = db.prepare(`SELECT AVG(${col}) AS a, COUNT(*) AS n FROM ${table} WHERE name = 'inet.loss' AND ts >= ?`).get(from) as { a: number | null; n: number }
  return {
    avgMs: ms.a === null ? null : Math.round(ms.a * 10) / 10,
    maxMs: ms.m === null ? null : Math.round(ms.m * 10) / 10,
    lossPct: loss.a === null ? null : Math.round(loss.a * 1000) / 10,
    samples: loss.n,
  }
}

// Среднее/максимум за сутки по каждой цели (из сырых замеров)
const TARGET_METRICS = { main: 'inet.ping_ms', second: 'inet.second_ms', router: 'inet.router_ms', prod: 'inet.prod_ms', adguard: 'inet.adguard_ms' } as const
function targetDay() {
  const from = Date.now() - 24 * 3600_000
  const q = db.prepare('SELECT AVG(value) AS a, MAX(value) AS m FROM metric_raw WHERE name = ? AND ts >= ?')
  const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10)
  return Object.fromEntries(
    Object.entries(TARGET_METRICS).map(([k, name]) => {
      const row = q.get(name, from) as { a: number | null; m: number | null }
      return [k, { avgMs: r1(row.a), maxMs: r1(row.m) }]
    }),
  ) as Record<keyof typeof TARGET_METRICS, { avgMs: number | null; maxMs: number | null }>
}

export function internetStatus() {
  const st = getState()
  return {
    now: last,
    downSince: st.downSince,
    ip: getSetting<IpInfo | null>(IP_KEY, null),
    outages: getSetting<Outage[]>(OUTAGES_KEY, []),
    day: statsSince('metric_raw', Date.now() - 24 * 3600_000),
    week: statsSince('metric_5m', Date.now() - 7 * 24 * 3600_000),
    targets: { main: PING_MAIN, second: PING_SECOND, router: PING_ROUTER, prod: PING_PROD, adguard: DNS_LOCAL },
    targetDay: targetDay(),
  }
}
