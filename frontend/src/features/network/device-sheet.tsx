import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { ExternalLink, Loader2, Radar, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { Device, DeviceType } from '@/lib/types'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { StatusBadge } from '@/components/status-badge'
import { Value } from '@/components/value'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { displayName, TYPES, webHref } from './device-meta'

type Props = { device: Device | null; scanning: { mac: string; started: number } | null; onClose: () => void }

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return <span className='tabular-nums'>{Math.max(0, Math.round((now - since) / 1000))} с</span>
}

// Карточка устройства: веб-интерфейс, порты, «Обновить порты» с прогрессом, редактирование
export function DeviceSheet({ device, scanning, onClose }: Props) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: '', type: 'unknown' as DeviceType, location: '', note: '', known: true })
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => {
    if (device)
      setForm({ name: device.name ?? '', type: device.type, location: device.location ?? '', note: device.note ?? '', known: true }) // открыл и сохранил = подписал; оставить «новым» можно переключателем
  }, [device?.mac]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/network/devices/${device!.mac}`, {
        name: form.name.trim() || null,
        type: form.type,
        location: form.location.trim() || null,
        note: form.note.trim() || null,
        known: form.known,
      }),
    onSuccess: () => {
      toast.success('Сохранено')
      qc.invalidateQueries({ queryKey: ['network'] })
    },
    onError: (e) => toast.error((e instanceof AxiosError && e.response?.data?.message) || 'ошибка'),
  })
  const scan = useMutation({
    mutationFn: () => api.post(`/network/devices/${device!.mac}/scan`, {}),
    onSuccess: () => {
      toast.info(`Сканирую порты ${device!.ip} (top-1000, до 3 минут)…`)
      qc.invalidateQueries({ queryKey: ['network'] })
    },
    onError: (e) => toast.error((e instanceof AxiosError && e.response?.data?.message) || 'ошибка'),
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/network/devices/${device!.mac}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['network'] })
      onClose()
    },
  })

  const d = device
  const isScanning = Boolean(d && scanning?.mac === d.mac)
  const busyOther = Boolean(scanning && d && scanning.mac !== d.mac)
  const web = d?.ports.filter((p) => p.web) ?? []

  return (
    <Sheet open={Boolean(d)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className='w-full gap-0 overflow-y-auto sm:max-w-lg'>
        {d && (
          <>
            <SheetHeader className='border-b'>
              <SheetTitle className='pe-6'>{displayName(d)}</SheetTitle>
              <SheetDescription asChild>
                <div className='flex flex-wrap items-center gap-2'>
                  <StatusBadge status={d.online ? 'ok' : 'unknown'} label={d.online ? 'онлайн' : 'офлайн'} />
                  <Value kind='address' value={d.ip} />
                  <Value kind='address' value={d.mac} />
                </div>
              </SheetDescription>
              {/* Главный веб-интерфейс (первый веб-порт) — кнопкой; остальные веб-порты кликабельны в списке портов */}
              {web.length > 0 && (
                <div className='flex flex-wrap items-center gap-2 pt-2'>
                  <Button size='sm' asChild>
                    <a href={webHref(d, web[0])} target='_blank' rel='noreferrer'>
                      <ExternalLink /> Открыть веб-интерфейс
                    </a>
                  </Button>
                  <span className='font-mono text-xs text-address'>:{web[0].port}</span>
                  {web.length > 1 && <span className='text-xs text-muted-foreground'>ещё {web.length - 1} веб-порт(а) — в списке ниже</span>}
                </div>
              )}
            </SheetHeader>

            <div className='space-y-5 p-4 text-sm'>
              <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'>
                <dt className='text-muted-foreground'>Производитель</dt>
                <dd>{d.vendor ?? (d.randomMac ? 'скрыт (приватный MAC)' : '—')}</dd>
                <dt className='text-muted-foreground'>Имя в сети</dt>
                <dd>{d.hostname ?? '—'}</dd>
                <dt className='text-muted-foreground'>Появилось</dt>
                <dd className='text-time'>{formatDateTime(d.firstSeen)}</dd>
                <dt className='text-muted-foreground'>Последний раз</dt>
                <dd>{d.online ? 'сейчас в сети' : <Value kind='ago' value={d.lastSeen} />}</dd>
              </dl>

              <section className='space-y-2'>
                <div className='flex items-center justify-between gap-2'>
                  <h3 className='font-medium'>Открытые порты (TCP, top-1000)</h3>
                  <Button size='sm' variant='outline' onClick={() => scan.mutate()} disabled={!d.online || isScanning || busyOther || scan.isPending}>
                    {isScanning ? <Loader2 className='animate-spin' /> : <Radar />} {isScanning ? 'Сканирую…' : 'Обновить порты'}
                  </Button>
                </div>
                <p className='text-xs text-muted-foreground'>
                  {isScanning && scanning ? (
                    <>
                      Идёт сканирование: <Elapsed since={scanning.started} /> (обычно до 1–3 минут)
                    </>
                  ) : busyOther ? (
                    'Сейчас сканируется другое устройство — дождитесь окончания.'
                  ) : !d.online ? (
                    'Устройство офлайн — сканировать нельзя.'
                  ) : d.portsScannedAt ? (
                    <>
                      Последний скан: {formatDateTime(d.portsScannedAt)} (<Value kind='ago' value={d.portsScannedAt} />)
                    </>
                  ) : (
                    'Порты ещё не сканировались.'
                  )}
                </p>
                {d.portsScannedAt && (
                  <div className='flex flex-wrap gap-1'>
                    {d.ports.length === 0 && <span className='text-muted-foreground'>открытых портов нет</span>}
                    {d.ports.map((p) =>
                      p.web ? (
                        <a
                          key={p.port}
                          href={webHref(d, p)}
                          target='_blank'
                          rel='noreferrer'
                          className='inline-flex items-center gap-1 rounded border px-2 py-1 font-mono text-xs text-address hover:bg-muted'
                        >
                          {p.port} {p.service} <ExternalLink className='size-3' />
                        </a>
                      ) : (
                        <span key={p.port} className='rounded bg-muted px-2 py-1 font-mono text-xs text-address'>
                          {p.port} {p.service}
                        </span>
                      )
                    )}
                  </div>
                )}
              </section>

              <section className='space-y-3 border-t pt-4'>
                <h3 className='font-medium'>Описание</h3>
                <div className='space-y-1'>
                  <Label htmlFor='dev-name'>Название</Label>
                  <Input id='dev-name' value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={d.hostname ?? 'например, «Телефон Ани»'} />
                </div>
                <div className='grid gap-3 sm:grid-cols-2'>
                  <div className='space-y-1'>
                    <Label>Тип</Label>
                    <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as DeviceType })}>
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
                  <div className='space-y-1'>
                    <Label htmlFor='dev-loc'>Расположение</Label>
                    <Input id='dev-loc' value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder='гостиная, кабинет…' />
                  </div>
                </div>
                <div className='space-y-1'>
                  <Label htmlFor='dev-note'>Заметка</Label>
                  <Textarea id='dev-note' rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </div>
                <label className='flex items-center gap-2'>
                  <Switch checked={form.known} onCheckedChange={(v) => setForm({ ...form, known: v })} /> Известное устройство (не подсвечивать как новое)
                </label>
                <div className='flex flex-wrap gap-2'>
                  <Button onClick={() => save.mutate()} disabled={save.isPending}>
                    <Save /> Сохранить
                  </Button>
                  {!d.online && (
                    <Button variant='ghost' onClick={() => setConfirmDelete(true)}>
                      <Trash2 /> Удалить из списка
                    </Button>
                  )}
                </div>
              </section>
            </div>
            {confirmDelete && (
              <ConfirmDialog
                open
                onOpenChange={(o) => !o && setConfirmDelete(false)}
                title={`Удалить ${displayName(d)} из списка?`}
                desc='Если устройство снова появится в сети, оно будет добавлено заново как новое.'
                confirmText='Удалить'
                destructive
                isLoading={remove.isPending}
                handleConfirm={() => remove.mutate()}
              />
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
