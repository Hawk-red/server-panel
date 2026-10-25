import { useState } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ReceiverSettingsLinks } from '@/features/media/receiver-settings-links'
import { ReceiverSection } from './index'

/** Вкладка «Marantz»: статус ресивера, его оригинальный пульт RC042SR и свёрнутые ссылки на веб-интерфейс */
export function MarantzTab() {
  const [open, setOpen] = useState(false)
  return (
    <div className='space-y-4'>
      <ReceiverSection view='remote' />
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button type='button' className='flex min-h-12 w-full items-center gap-2 rounded-lg border px-3 text-left hover:bg-muted' style={{ touchAction: 'manipulation' }}>
            <SlidersHorizontal className='size-5 shrink-0 text-pink-700 dark:text-pink-300' aria-hidden />
            <span className='font-medium'>Настройки ресивера</span>
            <span className='text-xs text-muted-foreground'>веб-интерфейс NR1604</span>
            <ChevronDown className={cn('ms-auto size-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className='pt-3'>
          <ReceiverSettingsLinks />
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
