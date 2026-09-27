import { type Direction, FILL_CLASS, LEVEL_TEXT, percentLevel, tempLevel } from '@/lib/levels'
import { cn } from '@/lib/utils'

type MeterProps = {
  /** 0–100 */
  value: number | null | undefined
  direction?: Direction
  /** для температуры — своя шкала вместо процентных порогов */
  temp?: 'cpu' | 'disk'
  className?: string
  label?: string
}

// Полоска заполнения с теми же порогами, что и Value. Уровень дублируется текстом для экранного диктора.
export function Meter({ value, direction = 'higher-worse', temp, className, label }: MeterProps) {
  if (value == null || !Number.isFinite(value)) return null
  const level = temp ? tempLevel(value, temp) : percentLevel(value, direction)
  const fill = level ? FILL_CLASS[level] : 'bg-info'
  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      role='meter'
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      aria-label={[label, level ? LEVEL_TEXT[level] : null].filter(Boolean).join(': ') || undefined}
    >
      <div className={cn('h-full rounded-full transition-all', fill)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}
