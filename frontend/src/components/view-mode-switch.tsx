import { Link } from '@tanstack/react-router'
import { Monitor, Smartphone, Tablet, Tv } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type ViewMode, useViewMode } from '@/lib/view-mode'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const OPTIONS: { mode: ViewMode; label: string; icon: React.ElementType }[] = [
  { mode: 'auto', label: 'Авто', icon: Monitor },
  { mode: 'phone', label: 'Телефон', icon: Smartphone },
  { mode: 'tablet', label: 'Планшет', icon: Tablet },
]

/** Вертикальное меню режима отображения (для dropdown в телефоне) */
export function ViewModeItems({ tvLink }: { tvLink: { to: string; params?: Record<string, string> } }) {
  const { mode, setMode } = useViewMode()
  return (
    <>
      <DropdownMenuLabel className='text-xs text-muted-foreground'>Режим отображения</DropdownMenuLabel>
      {OPTIONS.map((o) => (
        <DropdownMenuItem key={o.mode} onClick={() => setMode(o.mode)} className='flex justify-end px-2'>
          <o.icon className={cn('size-4', mode === o.mode && 'text-primary')} />
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <Link to={tvLink.to} params={tvLink.params}>
        <DropdownMenuItem className='flex justify-end px-2'>
          <Tv className='size-4' />
        </DropdownMenuItem>
      </Link>
    </>
  )
}

/** Горизонтальные кнопки режима отображения (для шапки на всех устройствах) */
export function ViewModeBar({ tvLink }: { tvLink: { to: string; params?: Record<string, string> } }) {
  const { mode, setMode } = useViewMode()
  return (
    <>
      {OPTIONS.map((o) => (
        <Button
          key={o.mode}
          variant={mode === o.mode ? 'default' : 'outline'}
          size='icon'
          onClick={() => setMode(o.mode)}
          className='h-7 w-7'
        >
          <o.icon className='size-4' />
        </Button>
      ))}
      <Link to={tvLink.to} params={tvLink.params}>
        <Button variant='outline' size='icon' className='h-7 w-7'>
          <Tv className='size-4' />
        </Button>
      </Link>
    </>
  )
}

// Единый переключатель режима отображения (на месте прежней кнопки «Режим ТВ»)
export function ViewModeSwitch({ tvLink }: { tvLink: { to: string; params?: Record<string, string> } }) {
  const { mode } = useViewMode()
  const current = OPTIONS.find((o) => o.mode === mode) ?? OPTIONS[0]
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant='outline' size='sm' aria-label='Режим отображения'>
          <current.icon /> Вид: {current.label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <ViewModeItems tvLink={tvLink} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}