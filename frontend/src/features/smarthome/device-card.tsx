import { Eye, EyeOff, ExternalLink, FolderInput, Pencil, Trash2, Ellipsis } from 'lucide-react'
import { KINDS, openUrl, type SmartDevice, statusLabel } from '@/lib/smarthome'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ICON_COMPONENT } from './icons'

export type CardActions = {
  onEdit: (d: SmartDevice) => void // ручное — полное окно; из HA — переименование
  onMove: (d: SmartDevice) => void
  onHide: (d: SmartDevice, hidden: boolean) => void
  onDelete: (d: SmartDevice) => void
  haHref: (haDeviceId: string) => string | null
}

function StatusDot({ state }: { state: SmartDevice['status']['state'] }) {
  const cls = state === 'online' ? 'bg-ok' : state === 'offline' ? 'bg-danger' : state === 'checking' ? 'animate-pulse bg-muted-foreground/60' : 'bg-muted-foreground/40'
  return <span className={cn('inline-block size-2.5 shrink-0 rounded-full', cls)} aria-hidden />
}

export function DeviceCard({ d, a }: { d: SmartDevice; a: CardActions }) {
  const Icon = ICON_COMPONENT[d.icon] ?? ICON_COMPONENT.other
  const isHa = d.source === 'homeassistant'
  const href = openUrl(d)
  const haHref = isHa && d.haDeviceId ? a.haHref(d.haDeviceId) : null
  const online = d.status.state === 'online'
  const sum = d.ha?.summary
  const canDelete = !isHa || d.haMissing
  return (
    <Card className='h-full min-h-44 gap-3 py-4'>
      <CardContent className='flex h-full flex-col gap-2.5 px-4'>
        <div className='flex items-start gap-3'>
          <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-full', online ? 'bg-ok/15 text-ok-foreground' : 'bg-muted text-muted-foreground')}>
            <Icon className='size-5' />
          </div>
          <div className='min-w-0 flex-1'>
            <h3 className='truncate font-medium' title={d.name}>
              {d.name}
            </h3>
            <p className='truncate text-xs text-muted-foreground'>{d.room ?? 'без комнаты'}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size='icon' variant='ghost' className='-me-2 -mt-1 size-8 shrink-0' aria-label={`Действия: ${d.name}`}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onSelect={() => a.onEdit(d)}>
                <Pencil /> {isHa ? 'Переименовать' : 'Изменить'}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => a.onMove(d)}>
                <FolderInput /> Переместить в группу…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => a.onHide(d, true)}>
                <EyeOff /> Скрыть
              </DropdownMenuItem>
              {canDelete && (
                <DropdownMenuItem variant='destructive' onSelect={() => a.onDelete(d)}>
                  <Trash2 /> Удалить
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className='flex items-center gap-2 text-sm' role='status'>
          <StatusDot state={d.status.state} />
          <span className={cn(online ? 'text-ok-foreground' : d.status.state === 'offline' ? 'text-danger-foreground' : 'text-muted-foreground')}>{statusLabel(d.status, d.source)}</span>
          {isHa && !d.haMissing && sum && d.ha?.available && sum.text !== 'доступно' && (
            <span className={cn('ms-auto truncate text-sm font-medium tabular-nums', sum.tone === 'on' ? 'text-ok-foreground' : 'text-foreground')}>{sum.text}</span>
          )}
        </div>
        {isHa && !d.haMissing && sum && sum.extras.length > 0 && d.ha?.available && (
          <p className='truncate text-xs text-muted-foreground tabular-nums'>{sum.extras.map((x) => `${x.label}: ${x.value}${x.unit ? ` ${x.unit}` : ''}`).join(' · ')}</p>
        )}
        {isHa && d.ha && (d.ha.manufacturer || d.ha.model) && <p className='truncate text-xs text-muted-foreground'>{[d.ha.manufacturer, d.ha.model].filter(Boolean).join(' ')}</p>}
        {d.notes && <p className='line-clamp-2 text-xs text-muted-foreground'>{d.notes}</p>}

        <div className='mt-auto flex items-center justify-between gap-2'>
          <span className='truncate text-[11px] text-muted-foreground'>{isHa ? `HA · ${d.ha?.integration ?? ''}` : KINDS.find((k) => k.id === d.kind)?.label}</span>
          {(href || haHref) && (
            <Button asChild size='sm' variant='outline'>
              <a href={(haHref ?? href)!} target='_blank' rel='noopener noreferrer'>
                <ExternalLink /> {haHref ? 'Открыть в HA' : 'Открыть'}
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function HiddenRow({ d, onShow }: { d: SmartDevice; onShow: (d: SmartDevice) => void }) {
  return (
    <div className='flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm'>
      <span className='truncate'>{d.name}</span>
      <Button size='sm' variant='ghost' onClick={() => onShow(d)}>
        <Eye /> Показать
      </Button>
    </div>
  )
}
