import { useState } from 'react'
import { Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// Ключи localStorage/sessionStorage конфига медиа-кнопок и выбранной под-вкладки (на случай если появятся —
// сейчас конфиг кнопок приходит с сервера, а вкладка живёт в ?tab=, но сбрасываем на будущее)
const MEDIA_STORAGE_PREFIXES = ['media.', 'media-hub.', 'universal.']

function clearMediaStorage() {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      for (const key of Object.keys(storage)) {
        if (MEDIA_STORAGE_PREFIXES.some((p) => key.startsWith(p))) storage.removeItem(key)
      }
    } catch {
      // приватный режим или хранилище недоступно — пропускаем молча
    }
  }
}

const RESTART_DELAY_MS = 700

/** Кнопка в шапке раздела «Медиа»: мягкий перезапуск фронтенда панели (локальный кэш/состояние + reload) */
export function PanelRestartButton() {
  const [restarting, setRestarting] = useState(false)

  const handleRestart = () => {
    if (restarting) return
    setRestarting(true)
    setTimeout(() => {
      clearMediaStorage()
      if ('serviceWorker' in navigator) {
        void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.update()))
      }
      window.location.reload()
    }, RESTART_DELAY_MS)
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size='icon'
          variant='destructive'
          aria-label='Перезапустить панель'
          className='scale-95 rounded-full'
          disabled={restarting}
          onClick={handleRestart}
        >
          <Wrench className={cn('size-[1.1rem]', restarting && 'animate-spin')} aria-hidden='true' />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Перезапустить панель</TooltipContent>
    </Tooltip>
  )
}
