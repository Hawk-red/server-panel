import { CircleAlert, TriangleAlert } from 'lucide-react'
import { formatBps, formatBytes, formatDuration, formatRelative } from '@/lib/format'
import { type Direction, type Level, LEVEL_TEXT, percentLevel, tempLevel, TEXT_CLASS } from '@/lib/levels'
import { cn } from '@/lib/utils'
import { NoData } from './no-data'

export type ValueKind = 'percent' | 'temp-cpu' | 'temp-disk' | 'bytes' | 'speed' | 'duration' | 'ago' | 'count' | 'address' | 'number'

type ValueProps = {
  kind: ValueKind
  value: number | string | null | undefined
  /** только для процентов: что значит «больше» */
  direction?: Direction
  digits?: number
  prefix?: string
  /** направление трафика: приём/отдача красятся единой парой цветов (--rx/--tx) */
  flow?: 'rx' | 'tx'
  suffix?: string
  className?: string
  /** значок уровня рядом со значением (warn/danger); по умолчанию включён */
  showLevelIcon?: boolean
  noDataReason?: string | null
}

// Цвет по типу величины (ТЗ v2, этап 8):
// проценты и температура — по порогу; объём — голубой; скорость — синий; время — фиолетовый приглушённый;
// счётчики — цвет текста, жирный; IP/MAC/порты/пути — моноширинный приглушённый голубой.
const KIND_CLASS: Partial<Record<ValueKind, string>> = {
  bytes: 'text-volume',
  speed: 'text-info',
  duration: 'text-time',
  ago: 'text-time',
  count: 'font-bold text-foreground',
  address: 'font-mono text-address',
  number: 'text-info',
}

export function valueLevel(kind: ValueKind, value: number, direction?: Direction): Level | null {
  if (kind === 'percent') return percentLevel(value, direction)
  if (kind === 'temp-cpu') return tempLevel(value, 'cpu')
  if (kind === 'temp-disk') return tempLevel(value, 'disk')
  return null
}

function format(kind: ValueKind, v: number | string, digits?: number) {
  if (typeof v === 'string') return v
  switch (kind) {
    case 'percent':
      return `${v.toFixed(digits ?? 0)}%`
    case 'temp-cpu':
    case 'temp-disk':
      return `${Math.round(v)} °C`
    case 'bytes':
      return formatBytes(v, digits ?? 1)
    case 'speed':
      return formatBps(v)
    case 'duration':
      return formatDuration(v)
    case 'ago':
      return formatRelative(v)
    case 'count':
      return v.toLocaleString('ru-RU')
    default:
      return digits != null ? v.toFixed(digits) : v.toLocaleString('ru-RU')
  }
}

export function Value({ kind, value, direction, digits, prefix, suffix, flow, className, showLevelIcon = true, noDataReason }: ValueProps) {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return <NoData reason={noDataReason} className={className} />
  const level = typeof value === 'number' ? valueLevel(kind, value, direction) : null
  const color = flow ? (flow === 'rx' ? 'text-rx' : 'text-tx') : level ? TEXT_CLASS[level] : kind === 'percent' ? 'text-info' : (KIND_CLASS[kind] ?? '')
  const Icon = level === 'danger' ? CircleAlert : level === 'warn' ? TriangleAlert : null
  return (
    <span className={cn('inline-flex items-baseline gap-1 tabular-nums', kind !== 'address' && 'whitespace-nowrap', color, className)}>
      {prefix}
      {format(kind, value, digits)}
      {suffix}
      {showLevelIcon && Icon && level && (
        <Icon className='size-[0.8em] shrink-0 self-center' aria-label={LEVEL_TEXT[level]}>
          <title>{LEVEL_TEXT[level]}</title>
        </Icon>
      )}
    </span>
  )
}
