import { formatDistanceToNowStrict } from 'date-fns'
import { ru } from 'date-fns/locale'

const UNITS = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']

export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—'
  let v = bytes
  let i = 0
  while (Math.abs(v) >= 1024 && i < UNITS.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : digits)} ${UNITS[i]}`
}

export function formatBps(bps: number | null | undefined): string {
  if (bps == null) return '—'
  return `${formatBytes(bps)}/с`
}

export function formatPercent(v: number | null | undefined, digits = 0): string {
  return v == null ? '—' : `${v.toFixed(digits)}%`
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return '—'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d} д ${h} ч`
  if (h > 0) return `${h} ч ${m} мин`
  return `${m} мин`
}

// Аптайм в разных масштабах: часы, дни, недели, месяцы (месяц = 30 дней)
export function formatUptimeScales(sec: number): string {
  const fmt = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString('ru-RU')
  const h = sec / 3600
  return `${fmt(h)} ч · ${fmt(h / 24)} дн · ${fmt(h / 24 / 7)} нед · ${fmt(h / 24 / 30)} мес`
}

export function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function formatRelative(ts: number | null | undefined): string {
  if (!ts) return '—'
  const s = formatDistanceToNowStrict(ts, { locale: ru })
  return ts > Date.now() ? `через ${s}` : `${s} назад`
}
