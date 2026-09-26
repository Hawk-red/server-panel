import { cn } from '@/lib/utils'

export type Status = 'ok' | 'warning' | 'error' | 'unknown'

const STYLE: Record<Status, { dot: string; text: string; label: string }> = {
  ok: { dot: 'bg-green-500', text: 'text-green-700 dark:text-green-400', label: 'работает' },
  warning: { dot: 'bg-yellow-500', text: 'text-yellow-700 dark:text-yellow-400', label: 'проблемы' },
  error: { dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400', label: 'не работает' },
  unknown: { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground', label: 'нет данных' },
}

type StatusBadgeProps = {
  status: Status
  label?: string
  className?: string
}

// Единый индикатор статуса: цветная точка + текст (без дублирующих иконок)
export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const s = STYLE[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', s.text, className)}>
      <span className={cn('size-2 shrink-0 rounded-full', s.dot)} aria-hidden='true' />
      {label ?? s.label}
    </span>
  )
}

// systemd active/sub → статус
export function unitStatus(active: string): Status {
  if (active === 'active') return 'ok'
  if (active === 'failed') return 'error'
  if (active === 'activating' || active === 'deactivating' || active === 'reloading') return 'warning'
  return 'unknown'
}
