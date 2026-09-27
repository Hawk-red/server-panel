// Telegram-боты сервера: alert_monitor (тревоги) и lead-бот внутри pulsdev-api
import { open, readFile } from 'node:fs/promises'
import { run } from '../exec.js'
import { httpJson } from '../http.js'

const AM_DIR = '/opt/alert_monitor'

async function tail(file: string, bytes = 2 * 1024 * 1024) {
  const fh = await open(file, 'r')
  try {
    const { size } = await fh.stat()
    const len = Math.min(bytes, size)
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, size - len)
    return buf.toString('utf8').split('\n').slice(1)
  } finally {
    await fh.close()
  }
}

const lineTs = (l: string) => {
  const m = l.match(/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/)
  return m ? Date.parse(m[1].replace(' ', 'T')) : null
}

// Имя бота через getMe (токен читается только на сервере, наружу не уходит). Кэш 1 ч.
let botCache: { at: number; name: string | null } | null = null
async function alertBotName() {
  if (botCache && Date.now() - botCache.at < 3_600_000) return botCache.name
  const cfg = JSON.parse(await readFile(`${AM_DIR}/config.json`, 'utf8'))
  const r = await httpJson<{ ok: boolean; result?: { username: string } }>(`https://api.telegram.org/bot${cfg.bot_token}/getMe`, {
    timeoutMs: 6000,
  })
  botCache = { at: Date.now(), name: r.result?.username ? `@${r.result.username}` : null }
  return botCache.name
}

export async function alertMonitor() {
  const cfg = JSON.parse(await readFile(`${AM_DIR}/config.json`, 'utf8').catch(() => '{}'))
  const subs = JSON.parse(await readFile(`${AM_DIR}/subscribers.json`, 'utf8').catch(() => '[]'))
  const lines = await tail(`${AM_DIR}/alert_monitor.log`)
  const dayAgo = Date.now() - 86_400_000

  // Реальная доставка — по опросу канала ([poll]); поздние события Telethon не в счёт
  const lags = lines
    .filter((l) => l.includes('⏱ [poll]') && (lineTs(l) ?? 0) > dayAgo)
    .map((l) => Number(l.match(/Задержка: ([\d.]+) сек/)?.[1]))
    .filter(Number.isFinite)
  const alerts = lines.filter((l) => l.includes('[poll] СОВПАДЕНИЕ'))
  const lastAlert = alerts.at(-1)
  const sends = lines.filter((l) => l.includes('Рассылка завершена') && (lineTs(l) ?? 0) > dayAgo)
  const lastMessage = [...lines].reverse().find((l) => l.includes('⏱ [poll]'))
  // Ошибки/предупреждения, кроме известного шума: «Аномальная задержка» от поздних событий Telethon
  const problems = lines
    .filter((l) => /\[(ERROR|WARNING|CRITICAL)\]/.test(l) && !/Аномальная задержка|\[poll\] СОВПАДЕНИЕ/.test(l))
    .slice(-15)
    .map((l) => ({ ts: lineTs(l), text: l.replace(/^\S+ \S+ /, '') }))

  return {
    bot: await alertBotName().catch(() => null),
    channel: cfg.monitored_channel ? `@${cfg.monitored_channel}` : null,
    subscribers: Array.isArray(subs) ? subs.length : Object.keys(subs ?? {}).length,
    delivery: lags.length
      ? { avgSec: Math.round((lags.reduce((a, b) => a + b, 0) / lags.length) * 10) / 10, maxSec: Math.max(...lags), messages: lags.length }
      : null,
    alertsToday: sends.length,
    lastAlert: lastAlert ? { ts: lineTs(lastAlert), text: lastAlert.replace(/^.*СОВПАДЕНИЕ \([^)]*\): /, '').slice(0, 200) } : null,
    lastChannelMessage: lastMessage ? lineTs(lastMessage) : null,
    problems,
  }
}

// Lead-бот pulsdev-api: токен в закрытом .env — только статистика из журнала
export async function leadBot() {
  const out = await run('/usr/bin/journalctl', ['-u', 'pulsdev-api.service', '-S', '-24h', '-o', 'json', '--output-fields=MESSAGE,__REALTIME_TIMESTAMP', '--no-pager'], {
    timeoutMs: 15_000,
  })
  const msgs = out
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .map((j) => ({ ts: Math.floor(Number(j.__REALTIME_TIMESTAMP) / 1000), text: String(j.MESSAGE ?? '') }))
  const pollErrors = msgs.filter((m) => m.text.includes('getUpdates error'))
  const leads = msgs.filter((m) => /lead/i.test(m.text) && !m.text.includes('getUpdates'))
  return {
    pollErrors24h: pollErrors.length,
    lastPollError: pollErrors.at(-1) ?? null,
    leadEvents24h: leads.length,
    recent: msgs.slice(-10),
  }
}
