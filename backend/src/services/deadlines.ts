// Сроки (этап 10.8): сертификат api.pulsdev.net (из TLS-рукопожатия), домены (RDAP), свои даты (токены, оплаты и т.п.)
// на одной карточке со счётчиком дней. Домены проверяются раз в 12 часов и кэшируются — регистраторы не любят частые запросы.
import { http } from '../http.js'
import { getSetting, setSetting } from '../settings.js'
import { certificate } from './sites.js'

export type DeadlineKind = 'cert' | 'domain' | 'token' | 'other'
export type Manual = { id: string; title: string; kind: 'domain' | 'token' | 'other'; date: string; note?: string }
export type DeadlineConfig = { domains: string[]; manual: Manual[] }
export type Deadline = {
  id: string
  title: string
  kind: DeadlineKind
  source: 'auto' | 'manual'
  /** ms; null — дату узнать не удалось */
  expires: number | null
  daysLeft: number | null
  note: string | null
  error: string | null
}

const CFG_KEY = 'deadlines.config'
const RDAP_KEY = 'deadlines.rdap'
const DAY = 86_400_000
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/

export const DEFAULT_CONFIG: DeadlineConfig = { domains: ['pulsdev.net', 'jetsetter.ua'], manual: [] }
export const getDeadlineConfig = (): DeadlineConfig => {
  const c = getSetting<Partial<DeadlineConfig>>(CFG_KEY, {})
  return { domains: c.domains ?? DEFAULT_CONFIG.domains, manual: c.manual ?? [] }
}

export function saveDeadlineConfig(input: DeadlineConfig) {
  const domains = [...new Set(input.domains.map((d) => d.trim().toLowerCase()))]
  for (const d of domains) if (!DOMAIN_RE.test(d)) throw Object.assign(new Error(`Некорректный домен: ${d}`), { statusCode: 400 })
  if (domains.length > 20 || input.manual.length > 50) throw Object.assign(new Error('Слишком много записей'), { statusCode: 400 })
  const manual = input.manual.map((m, i) => {
    const title = m.title.trim().slice(0, 80)
    if (!title) throw Object.assign(new Error('У записи нет названия'), { statusCode: 400 })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date) || Number.isNaN(Date.parse(m.date))) throw Object.assign(new Error(`Некорректная дата у «${title}»`), { statusCode: 400 })
    return { id: m.id || `m${Date.now().toString(36)}${i}`, title, kind: m.kind, date: m.date, note: m.note?.trim().slice(0, 200) || undefined }
  })
  setSetting(CFG_KEY, { domains, manual } satisfies DeadlineConfig)
  listCache = null
}

// ---------- RDAP (rdap.org перенаправляет к реестру нужной зоны: .net → Verisign, .ua → hostmaster.ua) ----------
type RdapCache = Record<string, { expires: number | null; checkedAt: number; error: string | null }>
let rdapBusy = false

async function rdapExpires(domain: string): Promise<number> {
  const res = await http(`https://rdap.org/domain/${domain}`, { timeoutMs: 12_000, headers: { accept: 'application/rdap+json, application/json', 'user-agent': 'server-panel/1.0 (home server admin panel)' } })
  const body = (await res.json()) as { events?: { eventAction: string; eventDate: string }[] }
  const t = Date.parse(body.events?.find((e) => e.eventAction === 'expiration')?.eventDate ?? '')
  if (!Number.isFinite(t)) throw new Error('в ответе реестра нет даты окончания')
  return t
}

export async function refreshDomains(force = false) {
  if (rdapBusy) return
  rdapBusy = true
  try {
    const cache = getSetting<RdapCache>(RDAP_KEY, {})
    const wanted = getDeadlineConfig().domains
    for (const d of wanted) {
      const c = cache[d]
      // успешный результат живёт 12 ч, ошибка — 30 мин
      const ttl = c && !c.error ? 12 * 3600_000 : 30 * 60_000
      if (!force && c && Date.now() - c.checkedAt < ttl) continue
      try {
        cache[d] = { expires: await rdapExpires(d), checkedAt: Date.now(), error: null }
      } catch (e) {
        cache[d] = { expires: c?.expires ?? null, checkedAt: Date.now(), error: `реестр не ответил: ${(e as Error).message}` }
      }
    }
    for (const d of Object.keys(cache)) if (!wanted.includes(d)) delete cache[d]
    setSetting(RDAP_KEY, cache)
  } finally {
    rdapBusy = false
  }
}

const daysUntil = (t: number) => Math.floor((t - Date.now()) / DAY)

let listCache: { at: number; data: Deadline[] } | null = null
export async function listDeadlines(): Promise<Deadline[]> {
  if (listCache && Date.now() - listCache.at < 60_000) return listCache.data
  const data = await buildDeadlines()
  listCache = { at: Date.now(), data }
  return data
}

async function buildDeadlines(): Promise<Deadline[]> {
  const out: Deadline[] = []
  // Сертификат
  try {
    const c = await certificate()
    out.push({ id: 'cert:api.pulsdev.net', title: 'Сертификат api.pulsdev.net', kind: 'cert', source: 'auto', expires: c.validTo, daysLeft: daysUntil(c.validTo), note: c.issuer ? `выдан: ${c.issuer}` : null, error: null })
  } catch (e) {
    out.push({ id: 'cert:api.pulsdev.net', title: 'Сертификат api.pulsdev.net', kind: 'cert', source: 'auto', expires: null, daysLeft: null, note: null, error: (e as Error).message })
  }
  // Домены (из кэша RDAP; первый раз — фоном)
  const cache = getSetting<RdapCache>(RDAP_KEY, {})
  const cfg = getDeadlineConfig()
  if (cfg.domains.some((d) => !cache[d])) void refreshDomains().catch(() => {})
  for (const d of cfg.domains) {
    const c = cache[d]
    out.push({
      id: `domain:${d}`,
      title: `Домен ${d}`,
      kind: 'domain',
      source: 'auto',
      expires: c?.expires ?? null,
      daysLeft: c?.expires ? daysUntil(c.expires) : null,
      note: null,
      error: c ? c.error : 'проверяется…',
    })
  }
  // Свои даты: конец указанного дня по местному времени
  for (const m of cfg.manual) {
    const t = Date.parse(`${m.date}T23:59:59`)
    out.push({ id: `manual:${m.id}`, title: m.title, kind: m.kind, source: 'manual', expires: t, daysLeft: daysUntil(t), note: m.note ?? null, error: null })
  }
  // Ближайшие сверху; без даты — в конец
  return out.sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9))
}

export function startDeadlines() {
  setTimeout(() => void refreshDomains().catch(() => {}), 20_000)
  setInterval(() => void refreshDomains().catch(() => {}), 3600_000)
}
