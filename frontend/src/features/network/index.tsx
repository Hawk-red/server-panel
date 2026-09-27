import { useMemo, useState } from 'react'
import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { ExternalLink, GripVertical, Loader2, Radio, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Device, NetworkData } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Page } from '@/components/layout/page'
import { StatusBadge } from '@/components/status-badge'
import { Value } from '@/components/value'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { DeviceSheet } from './device-sheet'
import { displayName, TYPE_GROUPS, TYPES, webHref } from './device-meta'

type StatusFilter = 'all' | 'online' | 'offline' | 'new'
const PORT_PREVIEW = 4

function DeviceCard({ d, scanning, onOpen, dragDisabled }: { d: Device; scanning: boolean; onOpen: () => void; dragDisabled: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: d.mac, disabled: dragDisabled })
  const T = TYPES[d.type] ?? TYPES.unknown
  const web = d.ports.find((p) => p.web)
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('min-w-0', isDragging && 'z-10 opacity-80')}>
      <Card className={cn('h-full gap-2 py-3', !d.known && 'border-warn/60 bg-warn/5', !d.online && 'opacity-70')}>
        <CardContent className='flex h-full gap-2 px-3 text-sm'>
          {!dragDisabled && (
            <button
              type='button'
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              className='-ms-1 flex w-6 shrink-0 cursor-grab touch-none items-start justify-center pt-1 text-muted-foreground active:cursor-grabbing'
              aria-label={`Перетащить ${displayName(d)}`}
            >
              <GripVertical className='size-4' />
            </button>
          )}
          {/* Вся карточка — кнопка открытия (удобно с пульта ТВ и с телефона) */}
          <button type='button' onClick={onOpen} className='min-w-0 flex-1 space-y-1.5 rounded-md text-start focus-visible:outline-none'>
            <div className='flex items-start gap-2'>
              <T.icon className='mt-0.5 size-5 shrink-0 text-muted-foreground' aria-hidden='true' />
              <div className='min-w-0 flex-1'>
                <div className='flex flex-wrap items-center gap-1.5'>
                  <span className='truncate font-medium'>{displayName(d)}</span>
                  {!d.known && <Badge className='bg-warn text-black hover:bg-warn'>новое</Badge>}
                </div>
                <div className='truncate text-xs text-muted-foreground'>
                  {T.label}
                  {d.location ? ` · ${d.location}` : ''}
                </div>
              </div>
              <StatusBadge status={d.online ? 'ok' : 'unknown'} label={d.online ? 'онлайн' : 'офлайн'} className='text-xs' />
            </div>
            <div className='flex flex-wrap gap-x-3 text-xs'>
              <Value kind='address' value={d.ip} />
              <span className='truncate text-muted-foreground'>{d.vendor ?? (d.randomMac ? 'приватный MAC' : '')}</span>
            </div>
            {scanning ? (
              <div className='flex items-center gap-1 text-xs text-info'>
                <Loader2 className='size-3 animate-spin' /> сканирую порты…
              </div>
            ) : d.portsScannedAt ? (
              <div className='flex flex-wrap gap-1'>
                {d.ports.length === 0 && <span className='text-xs text-muted-foreground'>открытых портов нет</span>}
                {d.ports.slice(0, PORT_PREVIEW).map((p) => (
                  <span key={p.port} className='rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-address'>
                    {p.port}
                  </span>
                ))}
                {d.ports.length > PORT_PREVIEW && <span className='text-xs text-muted-foreground'>ещё {d.ports.length - PORT_PREVIEW}</span>}
              </div>
            ) : null}
          </button>
          {web && (
            <Button size='icon' variant='ghost' className='shrink-0' asChild title={`Веб-интерфейс :${web.port}`}>
              <a href={webHref(d, web)} target='_blank' rel='noreferrer'>
                <ExternalLink />
              </a>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function Network({ initialDevice }: { initialDevice?: string } = {}) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<StatusFilter>('all')
  const [group, setGroup] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [openMac, setOpenMac] = useState<string | null>(initialDevice?.toLowerCase() ?? null)
  const { data } = useQuery({
    queryKey: ['network'],
    queryFn: async () => (await api.get<NetworkData>('/network')).data,
    refetchInterval: (query) => (query.state.data?.status.scanning ? 2_000 : 15_000),
  })
  const discover = useMutation({
    mutationFn: () => api.post<{ online: number }>('/network/discover', {}),
    onSuccess: (r) => {
      toast.success(`Сеть обновлена: онлайн ${r.data.online}`)
      qc.invalidateQueries({ queryKey: ['network'] })
    },
    onError: (e) => toast.error((e instanceof AxiosError && e.response?.data?.message) || 'ошибка'),
  })
  const reorder = useMutation({
    mutationFn: (macs: string[]) => api.put('/network/order', { macs }),
    onError: () => {
      toast.error('Порядок не сохранился')
      qc.invalidateQueries({ queryKey: ['network'] })
    },
  })

  const all = data?.devices ?? []
  const devices = useMemo(() => {
    const s = q.toLowerCase()
    const types = group ? TYPE_GROUPS.find((g) => g.id === group)?.types : null
    return all.filter(
      (d) =>
        (status === 'all' || (status === 'online' ? d.online : status === 'offline' ? !d.online : !d.known)) &&
        (!types || types.includes(d.type)) &&
        (!s || [d.name, d.hostname, d.vendor, d.ip, d.mac, d.location, d.note].some((x) => x?.toLowerCase().includes(s)))
    )
  }, [all, status, group, q])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Перетаскивание внутри отфильтрованного списка: видимые карточки меняются местами,
  // остальные остаются на своих позициях; порядок сохраняется на сервере
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const visible = devices.map((d) => d.mac)
    const moved = arrayMove(visible, visible.indexOf(String(e.active.id)), visible.indexOf(String(e.over.id)))
    const slots = new Set(visible)
    let k = 0
    const order = all.map((d) => (slots.has(d.mac) ? moved[k++] : d.mac))
    qc.setQueryData<NetworkData>(['network'], (old) =>
      old ? { ...old, devices: order.map((mac) => old.devices.find((x) => x.mac === mac)!).filter(Boolean) } : old
    )
    reorder.mutate(order)
  }

  const st = data?.status
  const ir = all.find((d) => d.type === 'ir')
  const open = all.find((d) => d.mac === openMac) ?? null
  const counts = (g: (typeof TYPE_GROUPS)[number]) => all.filter((d) => g.types.includes(d.type)).length

  return (
    <Page
      title='Сеть и устройства'
      description='Сканер локальной сети 192.168.31.0/24'
      actions={
        <Button onClick={() => discover.mutate()} disabled={discover.isPending}>
          <RefreshCw className={cn(discover.isPending && 'animate-spin')} /> Обновить сейчас
        </Button>
      }
    >
      {/* Сводка — одна компактная строка */}
      <Card className='py-3'>
        <CardContent className='grid grid-cols-2 gap-x-6 gap-y-2 px-4 text-sm md:grid-cols-4'>
          <div>
            <div className='text-xs text-muted-foreground'>Устройств</div>
            <Value kind='count' value={data?.summary.total} className='text-lg' />
          </div>
          <div>
            <div className='text-xs text-muted-foreground'>Онлайн</div>
            <Value kind='count' value={data?.summary.online} className='text-lg' />
          </div>
          <div>
            <div className='text-xs text-muted-foreground'>Неизвестных</div>
            <Value kind='count' value={data?.summary.unknown} className={cn('text-lg', data?.summary.unknown && 'text-warn-foreground')} />
          </div>
          <div>
            <div className='text-xs text-muted-foreground'>Последний скан</div>
            {st?.lastDiscovery ? <Value kind='ago' value={st.lastDiscovery} className='text-lg' /> : <span className='text-lg text-muted-foreground'>—</span>}
            <div className='text-[11px] text-muted-foreground'>{st?.arpScan ? 'arp-scan + nmap' : 'nmap + ARP'}, раз в 5 мин; порты — ночью в 03:30</div>
          </div>
        </CardContent>
      </Card>

      {ir && (
        <p className='mt-3 hidden items-start gap-2 text-sm text-muted-foreground sm:flex'>
          <Radio className='mt-0.5 size-4 shrink-0' />
          <span>
            ИК-передатчик: {ir.vendor} — <Value kind='address' value={ir.ip} />. Служба ИК-пульта на сервере (triggerhappy) с ним не связана: она
            работает со встроенным USB-приёмником Apple IR.
          </span>
        </p>
      )}

      <div className='mt-4 space-y-2'>
        {/* На телефоне фильтры — горизонтальные прокручиваемые строки, чтобы карточки были видны сразу */}
        <div className='-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0'>
          {(['all', 'online', 'offline', 'new'] as StatusFilter[]).map((f) => (
            <Button key={f} size='sm' className='shrink-0' variant={status === f ? 'default' : 'outline'} onClick={() => setStatus(f)}>
              {f === 'all' ? 'Все' : f === 'online' ? 'Онлайн' : f === 'offline' ? 'Офлайн' : `Неизвестные${data?.summary.unknown ? ` (${data.summary.unknown})` : ''}`}
            </Button>
          ))}
          <Input className='ms-auto hidden max-w-xs sm:block' placeholder='Поиск: имя, IP, MAC, производитель, место' value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className='-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0'>
          <Button size='sm' className='shrink-0' variant={group === null ? 'secondary' : 'ghost'} onClick={() => setGroup(null)}>
            Все типы
          </Button>
          {TYPE_GROUPS.map((g) => (
            <Button key={g.id} size='sm' className='shrink-0' variant={group === g.id ? 'secondary' : 'ghost'} onClick={() => setGroup(group === g.id ? null : g.id)}>
              {g.label} <span className='text-xs text-muted-foreground'>{counts(g)}</span>
            </Button>
          ))}
        </div>
        <Input className='sm:hidden' placeholder='Поиск: имя, IP, MAC, место' value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={devices.map((d) => d.mac)} strategy={rectSortingStrategy}>
          <div className='mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'>
            {devices.map((d) => (
              <DeviceCard key={d.mac} d={d} scanning={st?.scanning?.mac === d.mac} onOpen={() => setOpenMac(d.mac)} dragDisabled={false} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <p className='mt-3 text-xs text-muted-foreground'>
        Карточки можно перетаскивать за <GripVertical className='inline size-3' /> — порядок хранится на сервере и одинаков на телефоне, iPad и ПК.
      </p>

      <DeviceSheet device={open} scanning={st?.scanning ?? null} onClose={() => setOpenMac(null)} />
    </Page>
  )
}
