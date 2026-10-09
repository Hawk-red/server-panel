// Уведомления в Telegram (этап 10.1).
// Правила: служба упала (всегда), диск > 90% / > 95% (всегда), перегрев CPU, новое устройство,
// сертификат истекает < 14 дней, синк с ошибкой. Всё уходит сразу; в тихие часы (по Киеву) — без звука.
// «Утренняя сводка» (накопление в тихие часы) оставлена, но по умолчанию выключена. Без дублей: каждое условие — один раз при переходе
// порога, повтор только после возврата ниже порога с запасом (гистерезис).
import type { FastifyBaseLogger } from 'fastify'
import { getSnapshot } from './collector/index.js'
import { config } from './config.js'
import { onEvent, type ServerEvent } from './events.js'
import { errText } from './mask.js'
import { TYPE_LABEL, type DeviceType } from './network/scanner.js'
import { registryTokens } from './services/bots.js'
import { backupsOverview } from './services/backups.js'
import { listDeadlines } from './services/deadlines.js'
import { OUTAGE_NOTIFY_SEC } from './services/internet.js'
import { certificate } from './services/sites.js'
import { getSetting, setSetting } from './settings.js'
import type { DiskInfo } from './system/disks.js'

export type RuleId = 'unit' | 'disk' | 'temp' | 'device' | 'cert' | 'sync' | 'internet' | 'backup' | 'deadline' | 'upload' | 'torrents' | 'updates'

export const RULES: Record<RuleId, { title: string; urgent: string }> = {
  unit: { title: 'Служба упала (и снова поднялась)', urgent: 'падение — всегда, даже в тихие часы' },
  disk: { title: 'Диск заполнен > 90%', urgent: '> 95% — всегда, даже в тихие часы' },
  temp: { title: 'Перегрев CPU > 85 °C', urgent: '' },
  device: { title: 'Новое неизвестное устройство в сети', urgent: '' },
  cert: { title: 'Сертификат api.pulsdev.net истекает < 14 дней', urgent: '' },
  sync: { title: 'Ночной синк jetsetter с ошибкой', urgent: '' },
  internet: { title: 'Интернет пропал дольше 5 минут', urgent: 'сообщение придёт после восстановления связи — пока интернета нет, Telegram недоступен' },
  backup: { title: 'Резервная копия устарела', urgent: '' },
  deadline: { title: 'Срок домена или своей даты близко (за 30, 14, 7, 3 и 1 день)', urgent: '' },
  upload: { title: 'Гость загрузил файл в обменник (имя, размер, IP)', urgent: '' },
  torrents: { title: 'Торренты на паузу или возобновлены защитой диска', urgent: 'пауза — всегда, даже в тихие часы' },
  updates: { title: 'Обновления системы: новые пакеты, безопасность, Docker-образы, перезагрузка', urgent: '' },
}

export type NotifySettings = { chatId: number | null; enabled: boolean; quiet: { from: string; to: string }; digest: boolean; rules: Record<RuleId, boolean> }

const DEFAULTS: NotifySettings = {
  chatId: null,
  enabled: true,
  quiet: { from: '00:00', to: '09:00' },
  digest: false, // «Утренняя сводка»: false — все события уходят сразу (в тихие часы без звука)
  rules: { unit: true, disk: true, temp: true, device: true, cert: true, sync: true, internet: true, backup: true, deadline: true, upload: true, torrents: true, updates: true },
}

export const getNotifySettings = (): NotifySettings => {
  const s = getSetting<Partial<NotifySettings>>('notify', {})
  const quiet = { ...DEFAULTS.quiet, ...s.quiet }
  // прежние тихие часы по умолчанию (23:00–08:00) заменены на 00:00–09:00; свои значения не трогаем
  if (quiet.from === '23:00' && quiet.to === '08:00') Object.assign(quiet, DEFAULTS.quiet)
  return { ...DEFAULTS, ...s, quiet, rules: { ...DEFAULTS.rules, ...s.rules } }
}
export const saveNotifySettings = (s: NotifySettings) => setSetting('notify', s)

type Queued = { ts: number; text: string }
type Sent = { ts: number; text: string; ok: boolean; urgent: boolean; error?: string }
let log: FastifyBaseLogger | undefined

function minutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}
// Тихие часы считаются по Киеву независимо от часового пояса сервера (учитывает летнее/зимнее время)
export const QUIET_TZ = 'Europe/Kyiv'
const kyivFmt = new Intl.DateTimeFormat('en-GB', { timeZone: QUIET_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export function kyivMinutes(now: Date) {
  const p = kyivFmt.formatToParts(now)
  return Number(p.find((x) => x.type === 'hour')!.value) * 60 + Number(p.find((x) => x.type === 'minute')!.value)
}
export function inQuietHours(now = new Date(), q = getNotifySettings().quiet) {
  const cur = kyivMinutes(now)
  const from = minutes(q.from)
  const to = minutes(q.to)
  return from <= to ? cur >= from && cur < to : cur >= from || cur < to
}

// Понятные русские тексты вместо ответов Telegram API (токен в них не попадает никогда)
function tgError(code: number | undefined, description = ''): string {
  const d = description.toLowerCase()
  if (code === 409 || d.includes('conflict'))
    return 'Этот токен уже использует другой бот или процесс (он сам получает обновления через getUpdates). Для уведомлений панели нужен отдельный бот — создайте его в @BotFather и задайте его токен в NOTIFY_BOT_TOKEN.'
  if (code === 401 || d.includes('unauthorized')) return 'Telegram не принял токен: он отозван или введён с ошибкой. Задайте новый NOTIFY_BOT_TOKEN.'
  if (d.includes('upgraded to a supergroup')) return 'Группа стала супергруппой, и её chat_id изменился. Нажмите «Найти чат» (после сообщения боту в группе) и выберите группу заново.'
  if (d.includes('chat not found')) return 'Чат не найден: напишите боту /start и выберите чат заново.'
  if (code === 403 || d.includes('blocked')) return 'Бот не может писать в этот чат: он заблокирован или удалён из чата.'
  if (code === 429) return 'Telegram просит подождать: слишком много запросов. Повторите через минуту.'
  if (code === 404) return 'Telegram не узнал запрос: проверьте токен NOTIFY_BOT_TOKEN.'
  return `Telegram вернул ошибку${code ? ` ${code}` : ''}${description ? `: ${errText(description)}` : ''}`
}

// Токен уведомлений не должен совпадать с токеном рабочего бота из реестра (bots.json):
// getUpdates панели отбирал бы у него сообщения (409 Conflict). Проверка раз в 5 минут.
let conflictCache: { at: number; title: string | null } | null = null
export async function tokenConflict(): Promise<string | null> {
  if (!config.notifyToken) return null
  if (conflictCache && Date.now() - conflictCache.at < 300_000) return conflictCache.title
  const hit = (await registryTokens().catch(() => [])).find((b) => b.token === config.notifyToken!.trim())
  conflictCache = { at: Date.now(), title: hit?.title ?? null }
  return conflictCache.title
}

export async function tg<T>(method: string, body: Record<string, unknown>): Promise<T> {
  if (!config.notifyToken) throw new Error('не задан NOTIFY_BOT_TOKEN')
  const clash = await tokenConflict()
  if (clash) throw new Error(`NOTIFY_BOT_TOKEN совпадает с токеном бота «${clash}». Панели нужен свой отдельный бот — задайте другой токен.`)
  let res: Response
  try {
    res = await fetch(`https://api.telegram.org/bot${config.notifyToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (e) {
    throw new Error(`Telegram недоступен: ${(e as Error).name === 'TimeoutError' ? 'нет ответа за 10 с' : errText(e)}`)
  }
  const r = (await res.json().catch(() => null)) as { ok: boolean; result: T; error_code?: number; description?: string } | null
  if (!r?.ok) throw new Error(tgError(r?.error_code ?? res.status, r?.description))
  return r.result
}

function remember(entry: Sent) {
  const list = getSetting<Sent[]>('notify.sent', [])
  list.unshift(entry.error ? { ...entry, error: errText(entry.error) } : entry)
  setSetting('notify.sent', list.slice(0, 50))
}

// Сообщение о безопасности (внешний вход, блокировка IP) уходит сразу, минуя сводку
export const notifySecurity = (text: string) => send(text, true)

// Всё уходит сразу. В тихие часы (по Киеву) — без звука (disable_notification). Лавину сводим в одно сообщение,
// одинаковые подряд идущие сообщения не повторяем.
export const BURST_LIMIT = 20 // сообщений в минуту
export const BURST_WINDOW_MS = 60_000
export const DEDUP_MS = 10 * 60_000
const plain = (t: string) => t.replace(/<[^>]+>/g, '').replace(/\s*\n+\s*/g, ' · ')

type Transport = (method: string, body: Record<string, unknown>) => Promise<unknown>
let transport: Transport = tg
let clock = () => Date.now()
const burst = { start: 0, sent: 0, overflow: [] as string[], timer: undefined as ReturnType<typeof setTimeout> | undefined }
let lastSent: { text: string; at: number } | null = null
// только для тестов: подставной Telegram и часы
export const __test = {
  setup(t: Transport, c: () => number) {
    transport = t
    clock = c
    burst.start = 0
    burst.sent = 0
    burst.overflow = []
    clearTimeout(burst.timer)
    burst.timer = undefined
    lastSent = null
  },
  reset() {
    transport = tg
    clock = () => Date.now()
    clearTimeout(burst.timer)
    burst.timer = undefined
  },
}

async function deliver(text: string, urgent: boolean) {
  const s = getNotifySettings()
  const silent = inQuietHours(new Date(clock()), s.quiet)
  try {
    await transport('sendMessage', { chat_id: s.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, disable_notification: silent })
    remember({ ts: clock(), text, ok: true, urgent })
  } catch (e) {
    remember({ ts: clock(), text, ok: false, urgent, error: errText(e) })
    log?.warn({ err: errText(e) }, 'уведомление в Telegram не отправлено')
  }
}

// Остаток минуты после лимита — одним сообщением
export async function flushOverflow() {
  clearTimeout(burst.timer)
  burst.timer = undefined
  const items = burst.overflow
  if (!items.length) return
  burst.overflow = []
  burst.start = clock()
  burst.sent = 1
  const body = items.map(plain).join(' | ')
  await deliver(`➕ <b>ещё ${items.length} ${items.length === 1 ? 'событие' : 'событий'}:</b> ${esc(body).slice(0, 3600)}`, false)
}

export async function send(text: string, urgent: boolean) {
  const s = getNotifySettings()
  if (!s.enabled || !s.chatId || !config.notifyToken) return
  const now = clock()
  // выключаемая «Утренняя сводка»: старое поведение — обычные события в тихие часы копятся
  if (s.digest && !urgent && inQuietHours(new Date(now), s.quiet)) {
    const q = getSetting<Queued[]>('notify.queue', [])
    q.push({ ts: now, text })
    setSetting('notify.queue', q.slice(-100))
    return
  }
  if (lastSent && lastSent.text === text && now - lastSent.at < DEDUP_MS) {
    lastSent.at = now
    return
  }
  lastSent = { text, at: now }
  if (now - burst.start >= BURST_WINDOW_MS) {
    if (burst.overflow.length) await flushOverflow() // окно закончилось, а сводка ещё не ушла
    else {
      burst.start = now
      burst.sent = 0
    }
  }
  if (burst.sent >= BURST_LIMIT) {
    burst.overflow.push(text)
    if (!burst.timer) burst.timer = setTimeout(() => void flushOverflow().catch(() => {}), Math.max(1000, burst.start + BURST_WINDOW_MS - now))
    return
  }
  burst.sent++
  await deliver(text, urgent)
}

// Сводка накопленного за тихие часы — одним сообщением (только если «Утренняя сводка» включена;
// при выключенной всё, что успело накопиться раньше, отправляется один раз сразу)
export async function flushQueue() {
  const s = getNotifySettings()
  if (s.digest && inQuietHours()) return
  const q = getSetting<Queued[]>('notify.queue', [])
  if (!q.length) return
  setSetting('notify.queue', [])
  const time = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { timeZone: QUIET_TZ, hour: '2-digit', minute: '2-digit' })
  const text = [`🌙 <b>За тихие часы (${q.length})</b>`, '', ...q.map((x) => `${time(x.ts)} — ${plain(x.text)}`)].join('\n')
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

// Новое устройство: IP, полный MAC, производитель, имя, тип и время обнаружения (что неизвестно — строку не выводим)
function newDeviceText(e: ServerEvent) {
  const d = e.details as { ip?: string; mac?: string; vendor?: string | null; hostname?: string | null; type?: DeviceType; random?: boolean; ts?: number } | undefined
  if (!d?.mac) return `📡 ${esc(e.text)}`
  const when = new Date(d.ts ?? e.ts ?? Date.now()).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return [
    '📡 <b>Новое устройство в сети</b>',
    '',
    `🌐 IP: <code>${esc(d.ip ?? '—')}</code>`,
    `🔖 MAC: <code>${esc(d.mac)}</code>${d.random ? ' (частный, случайный адрес)' : ''}`,
    d.vendor ? `🏭 Производитель: ${esc(d.vendor)}` : null,
    d.hostname ? `🏷 Имя: ${esc(d.hostname)}` : null,
    d.type && d.type !== 'unknown' ? `📂 Тип: ${TYPE_LABEL[d.type] ?? esc(d.type)}` : null,
    `🕐 Обнаружено: ${when}`,
  ]
    .filter((x) => x !== null)
    .join('\n')
}

type UpdDetails = { total?: number; security?: number; newCount?: number; reboot?: boolean; count?: number; names?: string[]; container?: string; repo?: string }
function updatesAptText(e: ServerEvent) {
  const d = (e.details ?? {}) as UpdDetails
  const lines = [`📦 <b>Новые обновления системы:</b> ${d.total ?? '?'} пакетов`]
  if (d.security) lines.push(`🔴 из них безопасности: ${d.security}`)
  lines.push(`🔁 перезагрузка: ${d.reboot ? 'нужна' : 'не нужна'}`)
  return lines.join('\n')
}
function updatesSecurityText(e: ServerEvent) {
  const d = (e.details ?? {}) as UpdDetails
  const names = (d.names ?? []).map((n) => esc(n)).join(', ')
  return `🔴 <b>${d.count ?? '?'} обновлений безопасности</b>${names ? `\n${names}` : ''}`
}
function updatesDockerText(e: ServerEvent) {
  const d = (e.details ?? {}) as UpdDetails
  return `🐳 <b>Новая версия образа:</b> ${esc(d.container ?? e.target ?? '')}${d.repo ? ` (${esc(d.repo)})` : ''}`
}

function dockerUpdateText(e: ServerEvent) {
  const icon = e.level === 'info' ? '✅' : e.level === 'warning' ? '↩️' : '🔴'
  return `${icon} <b>Docker:</b> ${esc(e.text)}`
}

type GuardDetails = { freeGb: number; thresholdGb: number; path: string }
function guardPausedText(e: ServerEvent) {
  const d = e.details as GuardDetails | undefined
  return `⏸ Торренты поставлены на паузу (защита диска): свободно ${d?.freeGb ?? '?'} ГБ на ${esc(d?.path ?? '—')}, порог ${d?.thresholdGb ?? '?'} ГБ`
}
function guardResumedText(e: ServerEvent) {
  const d = e.details as GuardDetails | undefined
  return `▶ Торренты возобновлены: место освободилось, свободно ${d?.freeGb ?? '?'} ГБ на ${esc(d?.path ?? '—')}`
}

function onServerEvent(e: ServerEvent) {
  if (e.kind === 'unit.failed' && rule('unit')) void send(`🔴 <b>Служба упала:</b> ${esc(e.target ?? '')}`, true)
  else if (e.kind === 'unit.recovered' && rule('unit')) void send(`🟢 Служба снова работает: ${esc(e.target ?? '')}`, false)
  else if (e.kind === 'device.new' && rule('device')) void send(newDeviceText(e), false)
  else if (e.kind === 'sync.error' && rule('sync')) void send(`⚠️ ${esc(e.text)}`, false)
  // Обрыв интернета: событие приходит уже после восстановления связи
  else if (e.kind === 'internet.outage' && rule('internet') && ((e.details as { sec?: number } | undefined)?.sec ?? 0) >= OUTAGE_NOTIFY_SEC) void send(`🌐 ${esc(e.text)}`, false)
  else if (e.kind === 'exchange.upload' && rule('upload')) void send(`📥 ${esc(e.text)}`, false)
  else if (e.kind === 'internet.ip' && rule('internet')) void send(`🌐 ${esc(e.text)}`, false)
  // Защита диска (torrent-space-guard): пауза — срочно, возобновление — обычное
  else if (e.kind === 'torrents.paused' && rule('torrents')) void send(guardPausedText(e), true)
  // Обновления: одно сообщение на изменение (новые пакеты, безопасность, перезагрузка, Docker-образ). Тихие часы — как у остальных
  else if (e.kind === 'updates.apt' && rule('updates')) void send(updatesAptText(e), false)
  else if (e.kind === 'updates.security' && rule('updates')) void send(updatesSecurityText(e), false)
  else if (e.kind === 'updates.reboot' && rule('updates')) void send('🔁 <b>Нужна перезагрузка сервера</b> — обновлены ядро или системные библиотеки', false)
  else if (e.kind === 'updates.docker' && rule('updates')) void send(updatesDockerText(e), false)
  else if (e.kind === 'torrents.flow' && rule('torrents')) void send(`${e.level === 'info' ? '✅' : e.level === 'warning' ? '⚠️' : '🔴'} ${esc(e.text)}`, e.level !== 'info')
  else if (e.kind === 'docker.update' && rule('updates')) void send(dockerUpdateText(e), e.level !== 'info')
  else if (e.kind === 'torrents.resumed' && rule('torrents')) void send(guardResumedText(e), false)
}

// Диск: mount + модель/метка + тип носителя, занято/свободно в ГБ (не только проценты)
function diskDescriptor(d: DiskInfo) {
  return d.mount === '/' ? 'системный' : d.transport === 'usb' ? 'USB' : d.transport ?? '—'
}
function diskAlertText(d: DiskInfo, danger: boolean) {
  const name = d.label || d.model || d.mount || ''
  const p = Math.round(d.percent ?? 0)
  const usedGB = d.used != null ? Math.round(d.used / 1024 ** 3) : null
  const freeGB = d.free != null ? Math.round(d.free / 1024 ** 3) : null
  const totalGB = usedGB != null && freeGB != null ? usedGB + freeGB : null
  return [
    `${danger ? '🔴' : '🟡'} <b>Диск заполнен на ${p}%</b>`,
    '',
    `💾 ${esc(d.mount ?? '')} (${esc(name)}, ${esc(diskDescriptor(d))})`,
    totalGB != null ? `📊 занято ${usedGB} ГБ из ${totalGB}, свободно ${freeGB} ГБ` : null,
  ]
    .filter((x) => x !== null)
    .join('\n')
}

// Проверки по снимку коллектора (раз в минуту)
let hotCount = 0
function checkSnapshot() {
  const snap = getSnapshot()
  if (!snap) return
  if (rule('disk'))
    for (const d of snap.disks ?? []) {
      if (!d.mount || d.percent == null) continue
      if (d.percent > 95 && setFlag(`disk95:${d.mount}`, true)) void send(diskAlertText(d, true), true)
      else if (d.percent > 90 && setFlag(`disk90:${d.mount}`, true)) void send(diskAlertText(d, false), false)
      // Гистерезис с запасом: 10пп/5пп, а не 2пп — иначе обычные колебания (например, временная
      // закачка торрента на корневой SSD в /home/torrents-tmp) гонят флаг туда-обратно и дублируют
      // уведомление за те же несколько часов, хотя диск по сути всё время был заполнен
      if (d.percent < 90) setFlag(`disk95:${d.mount}`, false)
      if (d.percent < 80) setFlag(`disk90:${d.mount}`, false)
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

const ageText = (sec: number) => (sec < 48 * 3600 ? `${Math.round(sec / 3600)} ч` : `${Math.round(sec / 86400)} дн.`)

// Бэкапы: раз в час; сообщаем один раз, когда копия стала устаревшей, повтор — после того как она снова свежая
async function checkBackups() {
  if (!rule('backup')) return
  const items = await backupsOverview().catch(() => null)
  if (!items) return
  for (const b of items.filter((x) => x.type === 'scheduled')) {
    if (b.status === 'stale' || b.status === 'missing') {
      if (!setFlag(`backup:${b.id}`, true)) continue
      void send(
        b.status === 'missing'
          ? `🗄 <b>Копий нет:</b> ${esc(b.title)}`
          : `🗄 <b>Копия устарела:</b> ${esc(b.title)} — последней ${ageText(b.ageSec ?? 0)} назад (порог ${b.maxAgeH} ч)`,
        false
      )
    } else if (b.status === 'ok') setFlag(`backup:${b.id}`, false)
  }
}

// Сроки (домены и свои даты; сертификат — отдельное правило выше): за 30, 14, 7, 3 и 1 день
const DEADLINE_STEPS = [1, 3, 7, 14, 30]
async function checkDeadlines() {
  if (!rule('deadline')) return
  for (const d of await listDeadlines().catch(() => [])) {
    if (d.kind === 'cert' || d.daysLeft === null) continue
    const step = DEADLINE_STEPS.find((x) => d.daysLeft! <= x)
    if (step !== undefined && setFlag(`deadline:${d.id}:${step}`, true))
      void send(
        d.daysLeft < 0
          ? `📅 <b>${esc(d.title)}</b> — срок истёк ${-d.daysLeft} дн. назад`
          : `📅 <b>${esc(d.title)}</b> — осталось ${d.daysLeft} дн. (до ${new Date(d.expires!).toLocaleDateString('ru-RU')})`,
        false
      )
    if (d.daysLeft > 35) for (const x of DEADLINE_STEPS) setFlag(`deadline:${d.id}:${x}`, false)
  }
}

// Тест в выбранный чат или в переданный chatId (проверка перед сохранением; для группы — отрицательное число).
// Возвращает название чата, чтобы было видно, куда ушло сообщение.
export async function sendTest(chatId?: number) {
  const id = chatId ?? getNotifySettings().chatId
  if (!id) throw new Error('не выбран чат (chat_id)')
  const chat = await tg<{ id: number; type: string; title?: string; first_name?: string; username?: string }>('getChat', { chat_id: id })
  const name = chat.title ?? [chat.first_name, chat.username && `@${chat.username}`].filter(Boolean).join(' ')
  await tg('sendMessage', { chat_id: id, text: '✅ Тест: панель Mac Mini умеет присылать уведомления.' })
  remember({ ts: Date.now(), text: `Тестовое сообщение → ${name || id}`, ok: true, urgent: true })
  return { id, type: chat.type, name }
}

// Кто писал боту и куда его добавили — чтобы выбрать chat_id без ручного поиска.
// Личные чаты, группы, супергруппы и каналы. Группа появляется сразу после добавления в неё бота
// (событие my_chat_member), сообщение в группе не обязательно; но при включённом «Group Privacy» бот видит
// в группе только команды и упоминания — поэтому в подсказке просим написать /start@бот.
type ChatRef = { id: number; type: string; username?: string; first_name?: string; title?: string }
type Upd = {
  message?: { chat: ChatRef; text?: string; date: number }
  edited_message?: { chat: ChatRef; text?: string; date: number }
  channel_post?: { chat: ChatRef; text?: string; date: number }
  edited_channel_post?: { chat: ChatRef; text?: string; date: number }
  my_chat_member?: { chat: ChatRef; date: number; new_chat_member: { status: string } }
}
export type FoundChat = { id: number; name: string; type: string; last: number; text: string }

export async function detectChats() {
  const updates = await tg<Upd[]>('getUpdates', { limit: 100, timeout: 0 })
  const chats = new Map<number, FoundChat & { gone: boolean }>()
  const seen = (chat: ChatRef, date: number, text: string, gone?: boolean) => {
    const prev = chats.get(chat.id)
    if (prev && prev.last > date * 1000) return // обновления идут по возрастанию; берём самое свежее состояние
    chats.set(chat.id, {
      id: chat.id,
      name: chat.title ?? [chat.first_name, chat.username && `@${chat.username}`].filter(Boolean).join(' '),
      type: chat.type,
      last: date * 1000,
      text: text.slice(0, 40),
      gone: gone ?? prev?.gone ?? false,
    })
  }
  for (const u of updates) {
    const m = u.message ?? u.edited_message ?? u.channel_post ?? u.edited_channel_post
    if (m) seen(m.chat, m.date, m.text ?? '', false)
    else if (u.my_chat_member) {
      const st = u.my_chat_member.new_chat_member.status
      const gone = st === 'left' || st === 'kicked'
      seen(u.my_chat_member.chat, u.my_chat_member.date, gone ? 'бота убрали из чата' : 'бота добавили', gone)
    }
  }
  // чаты, откуда бота убрали, писать бесполезно
  return [...chats.values()].filter((c) => !c.gone).map(({ gone: _g, ...c }) => c).sort((a, b) => b.last - a.last)
}

export async function botInfo() {
  if (!config.notifyToken) return null
  return tg<{ username: string; first_name: string }>('getMe', {}).catch(() => null)
}

// Разовая чистка: ошибки с токеном, записанные в историю до появления маскирования
export function scrubSentSecrets() {
  const list = getSetting<Sent[]>('notify.sent', [])
  const clean = list.map((x) => (x.error ? { ...x, error: errText(x.error) } : x))
  if (JSON.stringify(clean) !== JSON.stringify(list)) setSetting('notify.sent', clean)
}

export async function notifyStatus() {
  return {
    tokenSet: Boolean(config.notifyToken),
    tokenConflict: await tokenConflict(),
    settings: getNotifySettings(),
    rules: RULES,
    quietNow: inQuietHours(),
    queued: getSetting<Queued[]>('notify.queue', []).length,
    sent: getSetting<Sent[]>('notify.sent', []).slice(0, 20),
  }
}

export function startNotifier(logger: FastifyBaseLogger) {
  log = logger
  scrubSentSecrets()
  onEvent(onServerEvent)
  setInterval(() => {
    try {
      checkSnapshot()
    } catch (e) {
      log?.debug({ err: errText(e) }, 'notifier: проверка снимка')
    }
    void flushQueue().catch(() => {})
  }, 60_000)
  const hourly = () => {
    void checkCert()
    void checkBackups().catch(() => {})
    void checkDeadlines().catch(() => {})
  }
  setInterval(hourly, 3_600_000)
  setTimeout(hourly, 90_000)
}
