import { Link } from '@tanstack/react-router'
import { Monitor, Smartphone, Tablet, Tv } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type ViewMode, useViewMode } from '@/lib/view-mode'
import { HeaderIconButton } from '@/components/layout/header-icon-button'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const OPTIONS: { mode: ViewMode; label: string; icon: React.ElementType }[] = [
  { mode: 'auto', label: 'Авто', icon: Monitor },
  { mode: 'phone', label: 'Телефон', icon: Smartphone },
  { mode: 'tablet', label: 'Планшет', icon: Tablet },
]

const MEDIA_OPTIONS = OPTIONS.filter((o) => o.mode === 'phone' || o.mode === 'tablet')

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

/** Горизонтальные кнопки режима отображения (для шапки на всех устройствах). media — компактный вид для «Пультa»: без «Авто» и «ТВ» */
export function ViewModeBar({ tvLink, media }: { tvLink: { to: string; params?: Record<string, string> }; media?: boolean }) {
  const { mode, setMode } = useViewMode()
  const opts = media ? MEDIA_OPTIONS : OPTIONS
  return (
    <>
      {opts.map((o) => (
        <HeaderIconButton key={o.mode} active={mode === o.mode} aria-label={o.label} aria-pressed={mode === o.mode} onClick={() => setMode(o.mode)}>
          <o.icon className='size-5' />
        </HeaderIconButton>
      ))}
      {!media && (
        <Link to={tvLink.to} params={tvLink.params}>
          <HeaderIconButton aria-label='Режим ТВ'>
            <Tv className='size-5' />
          </HeaderIconButton>
        </Link>
      )}
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