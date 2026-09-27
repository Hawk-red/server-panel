import { useMemo, useState } from 'react'
import { Value } from '@/components/value'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import {
  CircleHelp,
  Cpu,
  ExternalLink,
  Laptop,
  Loader2,
  Pencil,
  Printer,
  Radar,
  Radio,
  RefreshCw,
  Router,
  Server,
  Smartphone,
  Speaker,
  Tablet,
  Trash2,
  Tv,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatDateTime, formatRelative } from '@/lib/format'
import type { Device, DeviceType, NetworkData } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Page } from '@/components/layout/page'
import { StatTile } from '@/components/stat-tile'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

const TYPES: Record<DeviceType, { label: string; icon: React.ElementType }> = {
  router: { label: 'Роутер', icon: Router },
  server: { label: 'Сервер', icon: Server },
  laptop: { label: 'Ноутбук', icon: Laptop },
  phone: { label: 'Телефон', icon: Smartphone },
  tablet: { label: 'Планшет', icon: Tablet },
  tv: { label: 'ТВ / приставка', icon: Tv },
  receiver: { label: 'Ресивер / аудио', icon: Speaker },
  ir: { label: 'ИК-передатчик', icon: Radio },
  iot: { label: 'Умный дом / IoT', icon: Cpu },
  printer: { label: 'Принтер', icon: Printer },
  unknown: { label: 'Неизвестно', icon: CircleHelp },
}

type Filter = 'all' | 'online' | 'new'

function EditDialog({ device, onClose }: { device: Device; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(device.name ?? '')
  const [type, setType] = useState<DeviceType>(device.type)
  const [known, setKnown] = useState(true)
  const save = useMutation({
    mutationFn: () => api.patch(`/network/devices/${device.mac}`, { name: name.trim() || null, type, known }),
    onSuccess: () => {
      toast.success('Сохранено')
      qc.invalidateQueries({ queryKey: ['network'] })
      onClose()
    },
    onError: (e) => toast.error((e instanceof AxiosError && e.response?.data?.message) || 'ошибка'),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {device.ip} · {device.vendor ?? device.mac}
          </DialogTitle>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label>Название</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={device.hostname ?? 'например, «Телефон Ани»'} />
          </div>
          <div className='space-y-1'>
            <Label>Тип</Label>
            <Select value={type} onValueChange={(v) => setType(v as DeviceType)}>
              <SelectTrigger className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TYPES) as DeviceType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPES[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className='flex items-center gap-2 text-sm'>
            <Switch checked={known} onCheckedChange={setKnown} /> Известное устройство (не подсвечивать)
          </label>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeviceCard({ d, scanningMac, onEdit, onScan, onDelete }: { d: Device; scanningMac: string | null; onEdit: () => void; onScan: () => void; onDelete: () => void }) {
  const T = TYPES[d.type] ?? TYPES.unknown
  const scanning = scanningMac === d.mac
  return (
    <Card className={cn('gap-2 py-4', !d.known && 'border-warn/60 bg-warn/5', !d.online && 'opacity-70')}>
      <CardContent className='space-y-2 px-4 text-sm'>
        <div className='flex items-start gap-3'>
          <T.icon className='mt-0.5 size-6 shrink-0 text-muted-foreground' />
          <div className='min-w-0 flex-1'>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='truncate font-medium'>{d.name ?? d.hostname ?? d.vendor ?? 'Без названия'}</span>
              {!d.known && <Badge className='bg-warn text-black hover:bg-warn'>новое</Badge>}
            </div>
            <div className='text-xs text-muted-foreground'>
              {T.label}
              {d.hostname && d.name ? ` · ${d.hostname}` : ''}
            </div>
          </div>
          <StatusBadge status={d.online ? 'ok' : 'unknown'} label={d.online ? 'онлайн' : 'офлайн'} />
        </div>
        <dl className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs'>
          <dt className='text-muted-foreground'>IP</dt>
          <dd>
            <Value kind='address' value={d.ip} />
          </dd>
          <dt className='text-muted-foreground'>MAC</dt>
          <dd>
            <Value kind='address' value={d.mac} />
            {d.randomMac && <span className='ms-1 text-muted-foreground'>(случайный)</span>}
          </dd>
          <dt className='text-muted-foreground'>Производитель</dt>
          <dd>{d.vendor ?? (d.randomMac ? 'скрыт (приватный MAC)' : '—')}</dd>
          <dt className='text-muted-foreground'>Появилось</dt>
          <dd>{formatDateTime(d.firstSeen)}</dd>
          <dt className='text-muted-foreground'>Последний раз</dt>
          <dd>{d.online ? 'сейчас в сети' : <Value kind='ago' value={d.lastSeen} />}</dd>
        </dl>
        {d.portsScannedAt && (
          <div className='space-y-1'>
            <div className='text-xs text-muted-foreground'>
              Открытые порты (TCP, проверено {formatRelative(d.portsScannedAt)}): {d.ports.length === 0 && 'нет'}
            </div>
            <div className='flex flex-wrap gap-1'>
              {d.ports.map((p) =>
                p.web ? (
                  <a
                    key={p.port}
                    href={`${p.port === 443 || p.port === 8443 || p.service === 'https' ? 'https' : 'http'}://${d.ip}:${p.port}/`}
                    target='_blank'
                    rel='noreferrer'
                    className='inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs hover:bg-muted'
                  >
                    {p.port} {p.service} <ExternalLink className='size-3' />
                  </a>
                ) : (
                  <span key={p.port} className='rounded bg-muted px-1.5 py-0.5 text-xs'>
                    {p.port} {p.service}
                  </span>
                )
              )}
            </div>
          </div>
        )}
        <div className='flex flex-wrap gap-1 pt-1'>
          <Button size='sm' variant='outline' onClick={onEdit}>
            <Pencil /> Подписать
          </Button>
          <Button size='sm' variant='outline' onClick={onScan} disabled={!d.online || Boolean(scanningMac)}>
            {scanning ? <Loader2 className='animate-spin' /> : <Radar />} Порты
          </Button>
          {!d.online && (
            <Button size='sm' variant='ghost' onClick={onDelete} title='Удалить из списка'>
              <Trash2 />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function Network() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<Device | null>(null)
  const [del, setDel] = useState<Device | null>(null)
  const { data } = useQuery({
    queryKey: ['network'],
    queryFn: async () => (await api.get<NetworkData>('/network')).data,
    refetchInterval: (query) => (query.state.data?.status.scanning ? 3_000 : 15_000),
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
      toast.info(`Сканирую порты ${d.ip} (top-1000, до пары минут)…`)
      qc.invalidateQueries({ queryKey: ['network'] })
    },
    onError: (e) => toast.error((e instanceof AxiosError && e.response?.data?.message) || 'ошибка'),
  })
  const remove = useMutation({
    mutationFn: (d: Device) => api.delete(`/network/devices/${d.mac}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['network'] }),
    onSettled: () => setDel(null),
  })

  const devices = useMemo(() => {
    const s = q.toLowerCase()
    return (data?.devices ?? []).filter(
      (d) =>
        (filter === 'all' || (filter === 'online' ? d.online : !d.known)) &&
        (!s || [d.name, d.hostname, d.vendor, d.ip, d.mac].some((x) => x?.toLowerCase().includes(s)))
    )
  }, [data, filter, q])
  const st = data?.status
  const ir = data?.devices.find((d) => d.type === 'ir')

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
      <div className='grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4'>
        <StatTile title='Устройств' value={data ? <Value kind='count' value={data.summary.total} /> : null} sub='за всё время наблюдения' />
        <StatTile title='Сейчас онлайн' value={data ? <Value kind='count' value={data.summary.online} /> : null} />
        <StatTile
          title='Новые неизвестные'
          value={data ? <Value kind='count' value={data.summary.unknown} className={data.summary.unknown ? 'text-warn-foreground' : undefined} /> : null}
          sub={data?.summary.unknown ? 'подпишите их — кнопка «Подписать»' : 'все устройства известны'}
        />
        <StatTile
          className='col-span-2 lg:col-span-1'
          title='Сканирование'
          value={st?.lastDiscovery ? <Value kind='ago' value={st.lastDiscovery} /> : null}
          sub={
            <>
              раз в 5 мин · {st?.arpScan ? 'arp-scan + nmap' : 'nmap + ARP-таблица (arp-scan не установлен)'}
              <br />
              порты — по кнопке и ночью в 03:30{st?.nightly.lastRun ? ` (последний раз ${st.nightly.lastRun})` : ''}
            </>
          }
        />
      </div>

      {ir && (
        <p className='mt-4 flex items-start gap-2 rounded-md border p-3 text-sm'>
          <Radio className='mt-0.5 size-4 shrink-0' />
          <span>
            <b>ИК-передатчик:</b> по MAC-производителю это {ir.vendor} — {ir.ip} ({ir.mac}). Открытых TCP-портов у таких устройств обычно нет:
            управление идёт по UDP. Служба ИК-пульта на сервере (triggerhappy) с ним не связана — она работает со встроенным USB-приёмником Apple
            IR в самом Mac Mini, IP-адресов в её конфиге нет.
          </span>
        </p>
      )}

      <div className='mt-4 flex flex-wrap items-center gap-2'>
        {(['all', 'online', 'new'] as Filter[]).map((f) => (
          <Button key={f} size='sm' variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)}>
            {f === 'all' ? 'Все' : f === 'online' ? 'Онлайн' : `Новые${data?.summary.unknown ? ` (${data.summary.unknown})` : ''}`}
          </Button>
        ))}
        <Input className='ms-auto max-w-xs' placeholder='Поиск: имя, IP, MAC, производитель' value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className='mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
        {devices.map((d) => (
          <DeviceCard
            key={d.mac}
            d={d}
            scanningMac={st?.scanning?.mac ?? null}
            onEdit={() => setEdit(d)}
            onScan={() => scan.mutate(d)}
            onDelete={() => setDel(d)}
          />
        ))}
      </div>

      {edit && <EditDialog device={edit} onClose={() => setEdit(null)} />}
      {del && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDel(null)}
          title={`Удалить ${del.name ?? del.ip} из списка?`}
          desc='Если устройство снова появится в сети, оно будет добавлено заново как новое.'
          confirmText='Удалить'
          destructive
          isLoading={remove.isPending}
          handleConfirm={() => remove.mutate(del)}
        />
      )}
    </Page>
  )
}
