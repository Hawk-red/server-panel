// Уведомления в Telegram (этап 10.1).
// Правила: служба упала (всегда), диск > 90% / > 95% (всегда), перегрев CPU, новое устройство,
// сертификат истекает < 14 дней, синк с ошибкой. Тихие часы: обычные уведомления копятся
// и уходят одной сводкой в конце тихих часов. Без дублей: каждое условие — один раз при переходе
// порога, повтор только после возврата ниже порога с запасом (гистерезис).
import type { FastifyBaseLogger } from 'fastify'
import { getSnapshot } from './collector/index.js'
import { config } from './config.js'
import { onEvent, type ServerEvent } from './events.js'
import { httpJson } from './http.js'
import { certificate } from './services/sites.js'
import { getSetting, setSetting } from './settings.js'

export type RuleId = 'unit' | 'disk' | 'temp' | 'device' | 'cert' | 'sync'

export const RULES: Record<RuleId, { title: string; urgent: string }> = {
  unit: { title: 'Служба упала (и снова поднялась)', urgent: 'падение — всегда, даже в тихие часы' },
  disk: { title: 'Диск заполнен > 90%', urgent: '> 95% — всегда, даже в тихие часы' },
  temp: { title: 'Перегрев CPU > 85 °C', urgent: '' },
  device: { title: 'Новое неизвестное устройство в сети', urgent: '' },
  cert: { title: 'Сертификат api.pulsdev.net истекает < 14 дней', urgent: '' },
  sync: { title: 'Ночной синк jetsetter с ошибкой', urgent: '' },
}

export type NotifySettings = { chatId: number | null; enabled: boolean; quiet: { from: string; to: string }; rules: Record<RuleId, boolean> }

const DEFAULTS: NotifySettings = {
  chatId: null,
  enabled: true,
  quiet: { from: '23:00', to: '08:00' },
  rules: { unit: true, disk: true, temp: true, device: true, cert: true, sync: true },
}

export const getNotifySettings = (): NotifySettings => {
  const s = getSetting<Partial<NotifySettings>>('notify', {})
  return { ...DEFAULTS, ...s, quiet: { ...DEFAULTS.quiet, ...s.quiet }, rules: { ...DEFAULTS.rules, ...s.rules } }
}
export const saveNotifySettings = (s: NotifySettings) => setSetting('notify', s)

type Queued = { ts: number; text: string }
type Sent = { ts: number; text: string; ok: boolean; urgent: boolean; error?: string }
let log: FastifyBaseLogger | undefined

function minutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}
export function inQuietHours(now = new Date(), q = getNotifySettings().quiet) {
  const cur = now.getHours() * 60 + now.getMinutes()
  const from = minutes(q.from)
  const to = minutes(q.to)
  return from <= to ? cur >= from && cur < to : cur >= from || cur < to
}

export async function tg<T>(method: string, body: Record<string, unknown>): Promise<T> {
  if (!config.notifyToken) throw new Error('не задан NOTIFY_BOT_TOKEN')
  const r = await httpJson<{ ok: boolean; result: T; description?: string }>(`https://api.telegram.org/bot${config.notifyToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: 10_000,
  })
  if (!r.ok) throw new Error(r.description ?? 'Telegram вернул ошибку')
  return r.result
}

function remember(entry: Sent) {
  const list = getSetting<Sent[]>('notify.sent', [])
  list.unshift(entry)
  setSetting('notify.sent', list.slice(0, 50))
}

async function send(text: string, urgent: boolean) {
  const s = getNotifySettings()
  if (!s.enabled || !s.chatId || !config.notifyToken) return
  if (!urgent && inQuietHours()) {
    const q = getSetting<Queued[]>('notify.queue', [])
    q.push({ ts: Date.now(), text })
    setSetting('notify.queue', q.slice(-100))
    return
  }
  try {
    await tg('sendMessage', { chat_id: s.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
    remember({ ts: Date.now(), text, ok: true, urgent })
  } catch (e) {
    remember({ ts: Date.now(), text, ok: false, urgent, error: (e as Error).message })
    log?.warn({ err: (e as Error).message }, 'уведомление в Telegram не отправлено')
  }
}

// Сводка накопленного за тихие часы — одним сообщением
async function flushQueue() {
  if (inQuietHours()) return
  const q = getSetting<Queued[]>('notify.queue', [])
  if (!q.length) return
  setSetting('notify.queue', [])
  const time = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const text = [`🌙 <b>За тихие часы (${q.length})</b>`, '', ...q.map((x) => `${time(x.ts)} — ${x.text.replace(/<[^>]+>/g, '')}`)].join('\n')
  await send(text.slice(0, 3900), true)
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const rule = (id: RuleId) => getNotifySettings().rules[id]

// Состояние «уже сообщили» с гистерезисом — в настройках, переживает перезапуск
function flag(key: string) {
  return getSetting<Record<string, boolean>>('notify.flags', {})[key] ?? false
}
function setFlag(key: string, v: boolean) {
  const f = getSetting<Record<string, boolean>>('notify.flags', {})
  if ((f[key] ?? false) === v) return false
  f[key] = v
  setSetting('notify.flags', f)
  return true
}

function onServerEvent(e: ServerEvent) {
  if (e.kind === 'unit.failed' && rule('unit')) void send(`🔴 <b>Служба упала:</b> ${esc(e.target ?? '')}`, true)
  else if (e.kind === 'unit.recovered' && rule('unit')) void send(`🟢 Служба снова работает: ${esc(e.target ?? '')}`, false)
  else if (e.kind === 'device.new' && rule('device')) void send(`📡 ${esc(e.text)}`, false)
  else if (e.kind === 'sync.error' && rule('sync')) void send(`⚠️ ${esc(e.text)}`, false)
}

// Проверки по снимку коллектора (раз в минуту)
let hotCount = 0
function checkSnapshot() {
  const snap = getSnapshot()
  if (!snap) return
  if (rule('disk'))
    for (const d of snap.disks ?? []) {
      if (!d.mount || d.percent == null) continue
      const p = Math.round(d.percent)
      if (d.percent > 95 && setFlag(`disk95:${d.mount}`, true)) void send(`🔴 <b>Диск ${esc(d.mount)} заполнен на ${p}%</b> — выше 95%`, true)
      else if (d.percent > 90 && setFlag(`disk90:${d.mount}`, true)) void send(`🟡 Диск ${esc(d.mount)} заполнен на ${p}% — выше 90%`, false)
      if (d.percent < 93) setFlag(`disk95:${d.mount}`, false)
      if (d.percent < 88) setFlag(`disk90:${d.mount}`, false)
    }
  const t = snap.temperature?.cpu
  if (rule('temp') && t != null) {
    hotCount = t > 85 ? hotCount + 1 : 0
    if (hotCount >= 2 && setFlag('temp', true)) void send(`🔥 <b>Перегрев CPU:</b> ${Math.round(t)} °C (вентилятор ${snap.fan?.rpm ?? '?'} об/мин)`, false)
    if (t < 78) setFlag('temp', false)
  }
}

// Сертификат: раз в час; сообщаем на 14, 7, 3 и 1 день до срока
async function checkCert() {
  if (!rule('cert')) return
  const c = await certificate().catch(() => null)
  if (!c) return
  for (const d of [1, 3, 7, 14]) {
    if (c.daysLeft <= d) {
      if (setFlag(`cert:${d}`, true))
        void send(`🔐 Сертификат <b>api.pulsdev.net</b> истекает через ${c.daysLeft} дн. (${new Date(c.validTo).toLocaleDateString('ru-RU')})`, false)
      break
    }
  }
  if (c.daysLeft > 20) for (const d of [1, 3, 7, 14]) setFlag(`cert:${d}`, false)
}

export async function sendTest() {
  const s = getNotifySettings()
  if (!s.chatId) throw new Error('не выбран чат (chat_id)')
  await tg('sendMessage', { chat_id: s.chatId, text: '✅ Тест: панель Mac Mini умеет присылать уведомления.' })
  remember({ ts: Date.now(), text: 'Тестовое сообщение', ok: true, urgent: true })
}

// Кто писал боту — чтобы выбрать свой chat_id без ручного поиска
export async function detectChats() {
  const updates = await tg<{ message?: { chat: { id: number; type: string; username?: string; first_name?: string; title?: string }; text?: string; date: number } }[]>('getUpdates', { limit: 50, timeout: 0 })
  const chats = new Map<number, { id: number; name: string; type: string; last: number; text: string }>()
  for (const u of updates) {
    const m = u.message
    if (!m) continue
    chats.set(m.chat.id, {
      id: m.chat.id,
      name: m.chat.title ?? [m.chat.first_name, m.chat.username && `@${m.chat.username}`].filter(Boolean).join(' '),
      type: m.chat.type,
      last: m.date * 1000,
      text: (m.text ?? '').slice(0, 40),
    })
  }
  return [...chats.values()].sort((a, b) => b.last - a.last)
}

export async function botInfo() {
  if (!config.notifyToken) return null
  return tg<{ username: string; first_name: string }>('getMe', {}).catch(() => null)
}

export function notifyStatus() {
  return {
    tokenSet: Boolean(config.notifyToken),
    settings: getNotifySettings(),
    rules: RULES,
    quietNow: inQuietHours(),
    queued: getSetting<Queued[]>('notify.queue', []).length,
    sent: getSetting<Sent[]>('notify.sent', []).slice(0, 20),
  }
}

export function startNotifier(logger: FastifyBaseLogger) {
  log = logger
  onEvent(onServerEvent)
  setInterval(() => {
    try {
      checkSnapshot()
    } catch (e) {
      log?.debug({ err: (e as Error).message }, 'notifier: проверка снимка')
    }
    void flushQueue().catch(() => {})
  }, 60_000)
  setInterval(() => void checkCert(), 3_600_000)
  setTimeout(() => void checkCert(), 60_000)
}
