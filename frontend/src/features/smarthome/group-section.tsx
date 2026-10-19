import { ChevronDown, ChevronRight, Ellipsis, Pencil, Trash2 } from 'lucide-react'
import { deviceBlockId, type Group, groupLayoutPage, groupSummary, type SmartDevice } from '@/lib/smarthome'
import { cn } from '@/lib/utils'
import { type Block, SortableBlocks } from '@/components/sortable-blocks'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { type CardActions, DeviceCard } from './device-card'
import { ACCENT_BAR, ACCENT_TEXT, GROUP_ICON } from './icons'

// Блок-группа: заголовок с названием, значком, цветом-акцентом и счётчиком; внутри карточки устройств (сетка одинаковой высоты).
// compact — режим «порядок групп»: показывается только заголовок, чтобы группы было удобно перетаскивать.
// cardsSortable — режим «порядок карточек»: карточки внутри блока перетаскиваются.
export function GroupSection({ group, devices, collapsed, onToggle, compact, cardsSortable, actions, onRename, onDelete }: {
  group: Group
  devices: SmartDevice[]
  collapsed: boolean
  onToggle: () => void
  compact: boolean
  cardsSortable: boolean
  actions: CardActions
  onRename: (g: Group) => void
  onDelete: (g: Group) => void
}) {
  const Icon = GROUP_ICON[group.icon] ?? GROUP_ICON.box
  const open = !collapsed && !compact
  const blocks: Block[] = devices.map((d) => ({ id: deviceBlockId(d.id), title: d.name, node: <DeviceCard d={d} a={actions} /> }))
  return (
    <section aria-label={group.name} className={cn('h-full rounded-xl border border-l-4 bg-card/40 p-3 sm:p-4', ACCENT_BAR[group.accent])}>
      <div className='flex items-center gap-2'>
        <button type='button' onClick={onToggle} disabled={compact} aria-expanded={open} className='flex min-h-9 min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default'>
          {!compact && (open ? <ChevronDown className='size-4 shrink-0 text-muted-foreground' /> : <ChevronRight className='size-4 shrink-0 text-muted-foreground' />)}
          <Icon className={cn('size-5 shrink-0', ACCENT_TEXT[group.accent])} />
          <span className='min-w-0'>
            <span className='block truncate font-semibold'>{group.name}</span>
            <span className='block truncate text-xs text-muted-foreground'>{groupSummary(devices)}</span>
          </span>
        </button>
        {group.custom && !compact && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size='icon' variant='ghost' className='size-8 shrink-0' aria-label={`Действия с группой ${group.name}`}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onSelect={() => onRename(group)}>
                <Pencil /> Переименовать
              </DropdownMenuItem>
              <DropdownMenuItem variant='destructive' onSelect={() => onDelete(group)}>
                <Trash2 /> Удалить группу
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {open &&
        (devices.length === 0 ? (
          <Card className='mt-3 border-dashed bg-transparent px-4 py-5 text-center text-sm text-muted-foreground shadow-none'>В группе пока пусто: переместите сюда устройство через меню «⋯» на карточке.</Card>
        ) : (
          <div className='mt-3'>
            <SortableBlocks grid stable banner={false} sortable={cardsSortable} pageKey={groupLayoutPage(group.id)} blocks={blocks} className='grid gap-4 md:grid-cols-2 xl:grid-cols-3' />
          </div>
        ))}
    </section>
  )
}
