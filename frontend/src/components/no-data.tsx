import { cn } from '@/lib/utils'

// Источник недоступен — показываем «нет данных», а не ошибку
export function NoData({ reason, className }: { reason?: string | null; className?: string }) {
  return (
    <span className={cn('text-sm text-muted-foreground', className)} title={reason ?? undefined}>
      нет данных
    </span>
  )
}
