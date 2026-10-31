import { Link } from '@tanstack/react-router'
import { Check, Monitor, Smartphone, Tablet, Tv } from 'lucide-react'
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
        <DropdownMenuItem key={o.mode} onClick={() => setMode(o.mode)} className='flex justify-end'>
          <o.icon className='me-2' /> {o.label}
          <Check className={mode === o.mode ? 'size-3.5' : 'hidden'} />
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link to={tvLink.to as '/tv'} params={tvLink.params as never} className='flex justify-end'>
          <Tv className='me-2' /> ТВ
        </Link>
      </DropdownMenuItem>
    </>
  )
}

/** Горизонтальные кнопки режима отображения (для шапки на десктопе) */
export function ViewModeBar({ tvLink }: { tvLink: { to: string; params?: Record<string, string> } }) {
  const { mode, setMode } = useViewMode()
  return (
    <>
      {OPTIONS.map((o) => (
        <Button
          key={o.mode}
          variant={mode === o.mode ? 'default' : 'outline'}
          size='sm'
          onClick={() => setMode(o.mode)}
          className='h-7 px-2 text-xs'
        >
          <o.icon className='me-1 size-3.5' />
          {o.label}
        </Button>
      ))}
      <Link to={tvLink.to as '/tv'} params={tvLink.params as never}>
        <Button variant='outline' size='sm' className='h-7 px-2 text-xs'>
          <Tv className='me-1 size-3.5' />
          ТВ
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