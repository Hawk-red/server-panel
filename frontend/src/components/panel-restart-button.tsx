import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { HeaderIconButton } from '@/components/layout/header-icon-button'
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

// Эндпоинт сам выжидает 1,5 с и запускает `systemctl restart server-panel.service` в фоне (см. backend/src/routes/system.ts);
// здесь ждём дольше — пока служба реально остановится, пересоздастся и снова примет соединения, — и только потом перегружаем страницу
const RELOAD_DELAY_MS = 4000

/** Кнопка в шапке раздела «Медиа»: настоящий перезапуск службы server-panel (POST /api/system/panel/restart), затем reload.
 * compact — вписать в общий ряд кнопок шапки (HeaderIconButton) вместо отдельного крупного кружка (сайдбар) */
export function PanelRestartButton({ compact = false }: { compact?: boolean } = {}) {
  const [restarting, setRestarting] = useState(false)

  const handleRestart = () => {
    if (restarting) return
    setRestarting(true)
    toast.loading('Перезапуск панели…', { id: 'panel-restart' })
    void api.post('/api/system/panel/restart').catch(() => toast.error('Не удалось запустить перезапуск', { id: 'panel-restart' }))
    setTimeout(() => {
      clearMediaStorage()
      if ('serviceWorker' in navigator) {
        void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.update()))
      }
      window.location.reload()
    }, RELOAD_DELAY_MS)
  }

  const icon = <RefreshCw className={cn(compact ? 'size-5 text-red-500' : 'size-[1.1rem]', restarting && 'animate-spin')} aria-hidden='true' />

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {compact ? (
          // red — только у иконки (отличать от других кнопок по смыслу), сама кнопка — HeaderIconButton,
          // как и все остальные кнопки этого ряда, без собственного размера/формы/обводки
          <HeaderIconButton aria-label='Перезапустить панель' disabled={restarting} onClick={handleRestart}>
            {icon}
          </HeaderIconButton>
        ) : (
          <Button
            size='icon'
            variant='secondary'
            aria-label='Перезапустить панель'
            className='scale-95 rounded-full border-2 border-red-500 text-white'
            disabled={restarting}
            onClick={handleRestart}
          >
            {icon}
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent>Перезапустить панель</TooltipContent>
    </Tooltip>
  )
}
