import { cn } from '@/lib/utils'
import { useViewMode } from '@/lib/view-mode'
import { VolumeControl } from './volume-control'

/** Вкладка «Volume»: отдельный пульт с регулятором громкости */
export function VolumeTab() {
  const { view } = useViewMode()
  return (
    <div className={cn(
      'flex flex-col h-full min-h-0',
      view === 'phone' ? 'h-[calc(100dvh-var(--header-h,4rem)-env(safe-area-inset-bottom))]' : 'h-[calc(100vh-var(--header-h,4rem))]',
    )}>
      <VolumeControl fullScreen={view === 'phone'} />
    </div>
  )
}