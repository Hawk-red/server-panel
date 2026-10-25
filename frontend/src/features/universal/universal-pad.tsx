import { Ellipsis, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { uniRepeatable, uniStatus, type DeviceState, type UniButtonView } from '@/lib/universal-pad'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SCENE_BG, SCENE_ICON } from '@/features/smarthome/scene-style'
import { buzz, useHoldButton } from '@/features/receiver/use-hold'

// Плитки универсального пульта (столбец Samsung или Marantz): вид как у «Быстрых сцен», нажатие — как у экранных пультов
// (вдавливание, вибрация, удержание с автоповтором у громкости и стрелок). Данные приходят готовыми, запросов здесь нет.
export function UniTile({ b, st, editing, onPress, onEdit, onRemove }: {
  b: UniButtonView
  st: DeviceState
  editing: boolean
  onPress: (b: UniButtonView) => void
  onEdit: (b: UniButtonView) => void
  onRemove: (b: UniButtonView) => void
}) {
  const status = uniStatus(b, st)
  const Icon = SCENE_ICON[b.icon] ?? SCENE_ICON.sparkles
  const repeat = !editing && status.enabled && uniRepeatable(b)
  const hold = useHoldButton(() => onPress(b))
  const title = editing ? `${b.label}: ${b.title}` : status.enabled ? `${b.label} — ${b.title}` : `${b.label} — ${status.reason}`
  return (
    <div className='relative h-full'>
      <button
        type='button'
        data-tile={b.id}
        data-command={b.resolved ?? ''}
        data-state={editing ? 'edit' : status.enabled ? 'on' : 'off'}
        aria-label={b.label}
        aria-disabled={!status.enabled && !editing}
        title={title}
        style={{ touchAction: 'manipulation' }}
        className={cn(
          'flex h-full min-h-24 w-full flex-col justify-between gap-2 rounded-2xl p-3 text-left text-white shadow-sm transition-transform duration-100 select-none',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
          status.enabled || editing ? SCENE_BG[b.color] : 'bg-muted text-muted-foreground',
          status.enabled && !editing ? 'active:scale-95' : 'cursor-not-allowed',
          editing && 'outline-dashed outline-2 outline-offset-2 outline-info/70',
        )}
        {...(repeat ? hold : {})}
        onClick={
          repeat
            ? undefined
            : () => {
                if (editing) return onEdit(b)
                if (!status.enabled) return
                buzz()
                onPress(b)
              }
        }
      >
        <span className={cn('flex size-8 items-center justify-center rounded-full', status.enabled || editing ? 'bg-white/20' : 'bg-foreground/10')}>
          <Icon className='size-4' aria-hidden />
        </span>
        <span className='line-clamp-2 text-base leading-tight font-semibold break-words'>{b.label}</span>
      </button>
      {editing && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size='icon' variant='ghost' className='absolute end-1 top-1 size-7 text-white hover:bg-white/20 hover:text-white' aria-label={`Действия с кнопкой «${b.label}»`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onSelect={() => onEdit(b)}>
              <Pencil /> Подпись, цвет, значок…
            </DropdownMenuItem>
            <DropdownMenuItem variant='destructive' onSelect={() => onRemove(b)}>
              <Trash2 /> Удалить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

export function UniversalPad({ buttons, st, editing, onPress, onEdit, onRemove, wrap }: {
  buttons: UniButtonView[]
  st: DeviceState
  editing: boolean
  onPress: (b: UniButtonView) => void
  onEdit: (b: UniButtonView) => void
  onRemove: (b: UniButtonView) => void
  /** в режиме «Изменить» вкладка оборачивает плитку в перетаскиваемую обёртку */
  wrap?: (b: UniButtonView, node: React.ReactNode) => React.ReactNode
}) {
  if (buttons.length === 0) {
    return <p className='rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground'>Кнопок нет. Включите «Изменить» и добавьте нужные или сбросьте набор по умолчанию.</p>
  }
  return (
    <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4'>
      {buttons.map((b) => {
        const node = <UniTile key={b.id} b={b} st={st} editing={editing} onPress={onPress} onEdit={onEdit} onRemove={onRemove} />
        return wrap ? <div key={b.id}>{wrap(b, node)}</div> : node
      })}
    </div>
  )
}
