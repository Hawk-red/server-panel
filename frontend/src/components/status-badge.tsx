import { cn } from '@/lib/utils'

export type Status = 'ok' | 'warning' | 'error' | 'unknown'

// Единый индикатор статуса: цветная точка + текст (смысл всегда продублирован словом).
// Словарь один на всю панель: «в норме» / «внимание» / «сбой» / «нет данных». Нейтральные состояния
// (например, «на паузе») передают свою подпись через label, цвет точки при этом остаётся серым.
const STYLE: Record<Status, { dot: string; text: string; label: string }> = {
  ok: { dot: 'bg-ok', text: 'text-ok-foreground', label: 'в норме' },
  warning: { dot: 'bg-warn', text: 'text-warn-foreground', label: 'внимание' },
  error: { dot: 'bg-danger', text: 'text-danger-foreground', label: 'сбой' },
  unknown: { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground', label: 'нет данных' },
}

type StatusBadgeProps = {
  status: Status
  label?: string
  className?: string
}

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
