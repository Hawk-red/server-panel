// Общие мелочи для сворачиваемых блоков раздела «Обновления»: состояние в localStorage (с try/catch — хранилища может не быть).
import { useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export function readStored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}

export function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* хранилища нет — просто не запоминаем */
  }
}

// Значение, которое помнится между визитами. null = пользователь ещё не выбирал (работает значение по умолчанию)
export function usePersisted<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readStored(key, fallback))
  const set = (v: T) => {
    setValue(v)
    writeStored(key, v)
  }
  return [value, set] as const
}

// Состояние окна лога относится к конкретной задаче: новая задача начинает с настроек по умолчанию
type JobView = { id: string; collapsed?: boolean; hidden?: boolean }
export function useJobView(key: string, jobId: string | null, defaultCollapsed: boolean) {
  const [stored, setStored] = useState<JobView | null>(() => readStored<JobView | null>(key, null))
  const mine = stored && jobId && stored.id === jobId ? stored : null
  const update = (patch: Partial<JobView>) => {
    if (!jobId) return
    const next = { ...(mine ?? { id: jobId }), ...patch, id: jobId }
    setStored(next)
    writeStored(key, next)
  }
  return {
    hidden: !!mine?.hidden,
    collapsed: mine?.collapsed ?? defaultCollapsed,
    setCollapsed: (v: boolean) => update({ collapsed: v }),
    hide: () => update({ hidden: true }),
  }
}

// Кнопки «Свернуть/Развернуть» и «Скрыть»
export function FoldButtons({ collapsed, onToggle, onHide, className }: { collapsed: boolean; onToggle: () => void; onHide?: () => void; className?: string }) {
  return (
    <div className={cn('flex shrink-0 items-center gap-1', className)}>
      <Button size='sm' variant='ghost' className='h-7 gap-1 px-2 text-xs' onClick={onToggle} aria-expanded={!collapsed}>
        {collapsed ? 'Развернуть' : 'Свернуть'}
        <ChevronDown className={cn('size-3.5 transition-transform', !collapsed && 'rotate-180')} />
      </Button>
      {onHide && (
        <Button size='sm' variant='ghost' className='h-7 gap-1 px-2 text-xs' onClick={onHide}>
          Скрыть
          <X className='size-3.5' />
        </Button>
      )}
    </div>
  )
}
