import { useMemo, useState } from 'react'
import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { ExternalLink, GripVertical, Loader2, Pencil, Radio, RefreshCw, ScanSearch, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { Device, NetworkData } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Page } from '@/components/layout/page'
import { StatusBadge } from '@/components/status-badge'
import { Value } from '@/components/value'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { HomeLink } from '@/components/home-link'
import { DeviceSheet } from './device-sheet'
import { displayName, TYPE_GROUPS, TYPES, webHref } from './device-meta'

// Две независимые группы фильтров: статус (онлайн/офлайн + «неизвестные») и тип (несколько групп типов); между группами — «И»
type Conn = 'online' | 'offline'
const toggle = <T,>(set: Set<T>, v: T) => {
  const next = new Set(set)
  if (!next.delete(v)) next.add(v)
  return next
}

function DeviceCard({ d, scanning, busy, onOpen, onScan, dragDisabled }: { d: Device; scanning: boolean; busy: boolean; onOpen: () => void; onScan: () => void; dragDisabled: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: d.mac, disabled: dragDisabled })
  const T = TYPES[d.type] ?? TYPES.unknown
  const web = d.ports.find((p) => p.web)
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('min-w-0', isDragging && 'z-10 opacity-80')}>
      <Card className={cn('h-full gap-2 py-3', !d.known && 'border-warn/60 bg-warn/5', !d.online && 'opacity-75')}>
        <CardContent className='flex h-full flex-col gap-2 px-3 text-sm'>
          <div className='flex items-start gap-2'>
            {!dragDisabled && (
              <button
                type='button'
                ref={setActivatorNodeRef}
                {...attributes}
                {...listeners}
                className='-ms-1 flex w-6 shrink-0 cursor-grab touch-none justify-center pt-0.5 text-muted-foreground active:cursor-grabbing'
                aria-label={`Перетащить ${displayName(d)}`}
              >
                <GripVertical className='size-4' />
              </button>
            )}
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

          {/* Подробности прямо на карточке — без захода внутрь */}
          <dl className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs'>
            <dt className='text-muted-foreground'>IP</dt>
            <dd>
              <Value kind='address' value={d.ip} />
            </dd>
            <dt className='text-muted-foreground'>MAC</dt>
            <dd className='min-w-0 truncate'>
              <Value kind='address' value={d.mac} />
              {d.randomMac && <span className='ms-1 text-muted-foreground'>(приватный)</span>}
            </dd>
            <dt className='text-muted-foreground'>Производитель</dt>
            <dd className='truncate'>{d.vendor ?? (d.randomMac ? 'скрыт' : '—')}</dd>
            {d.hostname && (
              <>
                <dt className='text-muted-foreground'>Имя в сети</dt>
                <dd className='truncate'>{d.hostname}</dd>
              </>
            )}
            <dt className='text-muted-foreground'>Появилось</dt>
            <dd className='text-time'>{formatDateTime(d.firstSeen)}</dd>
            <dt className='text-muted-foreground'>Последний раз</dt>
            <dd>{d.online ? 'сейчас в сети' : <Value kind='ago' value={d.lastSeen} />}</dd>
          </dl>

          {d.note && <p className='line-clamp-2 text-xs text-muted-foreground'>{d.note}</p>}

          <div className='space-y-1'>
            {scanning ? (
              <div className='flex items-center gap-1 text-xs text-info'>
                <Loader2 className='size-3 animate-spin' /> сканирую порты…
              </div>
            ) : d.portsScannedAt ? (
              <>
                <div className='text-xs text-muted-foreground'>
                  Порты (TCP), проверено <Value kind='ago' value={d.portsScannedAt} />:{d.ports.length === 0 && ' открытых нет'}
                </div>
                <div className='flex flex-wrap gap-1'>
                  {d.ports.map((p) =>
                    p.web ? (
                      <HomeLink
                        key={p.port}
                        href={webHref(d, p)}
                        className='inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px] text-address hover:bg-muted'
                      >
                        {p.port} {p.service} <ExternalLink className='size-3' />
                      </HomeLink>
                    ) : (
                      <span key={p.port} className='rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-address'>
                        {p.port} {p.service}
                      </span>
                    )
                  )}
                </div>
              </>
            ) : (
              <div className='text-xs text-muted-foreground'>Порты ещё не сканировались.</div>
            )}
          </div>

          <div className='mt-auto flex flex-wrap gap-1 pt-1'>
            <Button size='sm' variant='outline' onClick={onScan} disabled={!d.online || scanning || busy} title={busy && !scanning ? 'Идёт сканирование другого устройства' : undefined}>
              {scanning ? <Loader2 className='animate-spin' /> : <ScanSearch />} Сканировать порты
            </Button>
            <Button size='sm' variant='outline' onClick={onOpen}>
              <Pencil /> Редактировать
            </Button>
            {web && (
              <Button size='sm' variant='ghost' asChild>
                <HomeLink href={webHref(d, web)}>
                  <ExternalLink /> Веб :{web.port}
                </HomeLink>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function Network({ initialDevice }: { initialDevice?: string } = {}) {
  const qc = useQueryClient()
  const [conn, setConn] = useState<Set<Conn>>(new Set()) // пусто или оба = без ограничения по связи
  const [unknownOnly, setUnknownOnly] = useState(false) // «Неизвестные» сужает выбор: неизвестные И (онлайн/офлайн)
  const [groups, setGroups] = useState<Set<string>>(new Set())
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
  const scan = useMutation({
    mutationFn: (d: Device) => api.post(`/network/devices/${d.mac}/scan`, {}),
    onSuccess: (_r, d) => {
      toast.info(`Сканирую порты ${d.ip} (top-1000, обычно до минуты)…`)
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
    const types = groups.size ? TYPE_GROUPS.filter((g) => groups.has(g.id)).flatMap((g) => g.types) : null
    const byConn = conn.size === 1
    return all.filter(
      (d) =>
        (!byConn || (conn.has('online') ? d.online : !d.online)) &&
        (!unknownOnly || !d.known) &&
        (!types || types.includes(d.type)) &&
        (!s || [d.name, d.hostname, d.vendor, d.ip, d.mac, d.location, d.note].some((x) => x?.toLowerCase().includes(s)))
    )
  }, [all, conn, unknownOnly, groups, q])

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
  const ir = all.find((d) => /broadlink/i.test(d.vendor ?? ''))
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
        {/* Две независимые группы фильтров. На телефоне — горизонтальные прокручиваемые строки, чтобы карточки были видны сразу */}
        <div className='-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0' role='group' aria-label='Фильтр по статусу'>
          <span className='w-14 shrink-0 text-xs text-muted-foreground'>Статус</span>
          <Button size='sm' className='shrink-0' variant={conn.has('online') ? 'default' : 'outline'} aria-pressed={conn.has('online')} onClick={() => setConn(toggle(conn, 'online'))}>
            Онлайн <span className='text-xs opacity-70'>{data?.summary.online ?? ''}</span>
          </Button>
          <Button size='sm' className='shrink-0' variant={conn.has('offline') ? 'default' : 'outline'} aria-pressed={conn.has('offline')} onClick={() => setConn(toggle(conn, 'offline'))}>
            Офлайн <span className='text-xs opacity-70'>{data ? data.summary.total - data.summary.online : ''}</span>
          </Button>
          <Button size='sm' className='shrink-0' variant={unknownOnly ? 'default' : 'outline'} aria-pressed={unknownOnly} onClick={() => setUnknownOnly(!unknownOnly)}>
            Неизвестные <span className='text-xs opacity-70'>{data?.summary.unknown ?? ''}</span>
          </Button>
          {(conn.size > 0 || unknownOnly) && (
            <Button size='sm' variant='ghost' className='shrink-0 text-muted-foreground' onClick={() => (setConn(new Set()), setUnknownOnly(false))}>
              <X /> Сбросить
            </Button>
          )}
          <Input className='ms-auto hidden max-w-xs sm:block' placeholder='Поиск: имя, IP, MAC, производитель, место' value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className='-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0' role='group' aria-label='Фильтр по типу'>
          <span className='w-14 shrink-0 text-xs text-muted-foreground'>Тип</span>
          {TYPE_GROUPS.map((g) => (
            <Button key={g.id} size='sm' className='shrink-0' variant={groups.has(g.id) ? 'default' : 'outline'} aria-pressed={groups.has(g.id)} onClick={() => setGroups(toggle(groups, g.id))}>
              {g.label} <span className='text-xs opacity-70'>{counts(g)}</span>
            </Button>
          ))}
          {groups.size > 0 && (
            <Button size='sm' variant='ghost' className='shrink-0 text-muted-foreground' onClick={() => setGroups(new Set())}>
              <X /> Сбросить
            </Button>
          )}
        </div>
        <Input className='sm:hidden' placeholder='Поиск: имя, IP, MAC, место' value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={devices.map((d) => d.mac)} strategy={rectSortingStrategy}>
          <div className='mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'>
            {devices.map((d) => (
              <DeviceCard
                key={d.mac}
                d={d}
                scanning={st?.scanning?.mac === d.mac || (scan.isPending && scan.variables?.mac === d.mac)}
                busy={Boolean(st?.scanning) || scan.isPending}
                onOpen={() => setOpenMac(d.mac)}
                onScan={() => scan.mutate(d)}
                dragDisabled={false}
              />
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
