import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { AirVent, Box, Camera, Ellipsis, ExternalLink, Lightbulb, Lock, Pencil, Plug, Plus, Router, Speaker, Thermometer, Trash2, Tv } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import {
  addressFields, ALL_ROOMS, DEFAULT_ROOMS, deviceBlockId, type DeviceForm, emptyForm, EXAMPLES, filterByRoom, ICONS, type IconId, KINDS, MAX_DEVICES, NO_ROOM,
  openUrl, roomsOf, type SmartDevice, SMARTHOME_LAYOUT_PAGE, statusLabel, summaryText, toForm, toPayload, validateForm,
} from '@/lib/smarthome'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Page } from '@/components/layout/page'
import { useLayoutEdit } from '@/components/layout/layout-edit'
import { type Block, SortableBlocks } from '@/components/sortable-blocks'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

const ICON_COMPONENT: Record<IconId, typeof Box> = {
  lamp: Lightbulb, socket: Plug, sensor: Thermometer, camera: Camera, lock: Lock, ac: AirVent, tv: Tv, router: Router, speaker: Speaker, other: Box,
}

type DevicesResponse = { devices: SmartDevice[]; now: number }
type ApiError = { message?: string; field?: string }
const apiError = (e: unknown): ApiError => (e instanceof AxiosError ? ((e.response?.data as ApiError | undefined) ?? { message: e.message }) : { message: (e as Error).message })

// ---------- карточка устройства ----------
function StatusDot({ state }: { state: SmartDevice['status']['state'] }) {
  const cls = state === 'online' ? 'bg-ok' : state === 'offline' ? 'bg-danger' : state === 'checking' ? 'animate-pulse bg-muted-foreground/60' : 'bg-muted-foreground/40'
  return <span className={cn('inline-block size-2.5 shrink-0 rounded-full', cls)} aria-hidden />
}

function DeviceCard({ d, onEdit, onDelete }: { d: SmartDevice; onEdit: (d: SmartDevice) => void; onDelete: (d: SmartDevice) => void }) {
  const Icon = ICON_COMPONENT[d.icon] ?? Box
  const href = openUrl(d)
  const online = d.status.state === 'online'
  return (
    <Card className='h-full min-h-44 gap-3 py-4'>
      <CardContent className='flex h-full flex-col gap-3 px-4'>
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
              <DropdownMenuItem onSelect={() => onEdit(d)}>
                <Pencil /> Изменить
              </DropdownMenuItem>
              <DropdownMenuItem variant='destructive' onSelect={() => onDelete(d)}>
                <Trash2 /> Удалить
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className='flex items-center gap-2 text-sm' role='status'>
          <StatusDot state={d.status.state} />
          <span className={cn(online ? 'text-ok-foreground' : d.status.state === 'offline' ? 'text-danger-foreground' : 'text-muted-foreground')}>{statusLabel(d.status)}</span>
        </div>
        {d.notes && <p className='line-clamp-2 text-xs text-muted-foreground'>{d.notes}</p>}

        <div className='mt-auto flex items-center justify-between gap-2'>
          <span className='truncate text-[11px] text-muted-foreground'>{KINDS.find((k) => k.id === d.kind)?.label}</span>
          {href && (
            <Button asChild size='sm' variant='outline'>
              <a href={href} target='_blank' rel='noopener noreferrer'>
                <ExternalLink /> Открыть
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------- окно «Добавить / изменить устройство» ----------
function DeviceDialog({ open, editing, initial, rooms, onClose }: { open: boolean; editing: SmartDevice | null; initial: DeviceForm; rooms: string[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState<DeviceForm>(initial)
  const [errors, setErrors] = useState<Partial<Record<keyof DeviceForm, string>>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const set = <K extends keyof DeviceForm>(k: K, v: DeviceForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }
  const fields = addressFields(form.kind)
  const suggestions = [...new Set([...rooms, ...DEFAULT_ROOMS])]

  const save = useMutation({
    mutationFn: async () => {
      const body = toPayload(form)
      return editing ? (await api.put(`/smarthome/devices/${editing.id}`, body)).data : (await api.post('/smarthome/devices', body)).data
    },
    onSuccess: () => {
      toast.success(editing ? 'Устройство изменено' : 'Устройство добавлено')
      qc.invalidateQueries({ queryKey: ['smarthome'] })
      onClose()
    },
    onError: (e) => {
      const { message, field } = apiError(e)
      if (field && field in form) setErrors({ [field]: message })
      else setServerError(message ?? 'не удалось сохранить')
    },
  })

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault()
    setServerError(null)
    const errs = validateForm(form)
    setErrors(errs)
    if (Object.keys(errs).length === 0) save.mutate()
  }
  const err = (k: keyof DeviceForm) => errors[k] && <p className='text-xs text-danger-foreground'>{errors[k]}</p>

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className='max-h-[92dvh] overflow-y-auto sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{editing ? 'Изменить устройство' : 'Добавить устройство'}</DialogTitle>
          <DialogDescription>Панель только проверяет доступность устройства в локальной сети и не отправляет ему команд.</DialogDescription>
        </DialogHeader>
        <form className='space-y-4' onSubmit={submit} noValidate>
          <div className='space-y-1.5'>
            <Label htmlFor='sh-name'>Название</Label>
            <Input id='sh-name' value={form.name} maxLength={60} onChange={(e) => set('name', e.target.value)} autoFocus placeholder='Лампа в гостиной' />
            {err('name')}
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label htmlFor='sh-kind'>Тип</Label>
              <Select value={form.kind} onValueChange={(v) => set('kind', v as DeviceForm['kind'])}>
                <SelectTrigger id='sh-kind' className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className='text-xs text-muted-foreground'>{KINDS.find((k) => k.id === form.kind)?.hint}</p>
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='sh-room'>Комната</Label>
              <Input id='sh-room' list='sh-rooms' value={form.room} maxLength={40} onChange={(e) => set('room', e.target.value)} placeholder='Гостиная (можно пусто)' />
              <datalist id='sh-rooms'>
                {suggestions.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              {err('room')}
            </div>
          </div>

          <div className='space-y-1.5'>
            <Label>Значок</Label>
            <div className='grid grid-cols-[repeat(5,minmax(0,1fr))] gap-1.5' role='radiogroup' aria-label='Значок'>
              {ICONS.map((i) => {
                const Ic = ICON_COMPONENT[i.id]
                const on = form.icon === i.id
                return (
                  <button
                    key={i.id}
                    type='button'
                    role='radio'
                    aria-checked={on}
                    title={i.label}
                    onClick={() => set('icon', i.id)}
                    className={cn('flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-0.5 py-1.5 text-[11px] transition-colors', on ? 'border-info bg-info/10 text-foreground' : 'text-muted-foreground hover:bg-muted/60')}
                  >
                    <Ic className='size-5' />
                    <span className='max-w-full truncate'>{i.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {fields.url && (
            <div className='space-y-1.5'>
              <Label htmlFor='sh-url'>Ссылка на веб-интерфейс{form.kind === 'link' ? '' : ' (необязательно)'}</Label>
              <Input id='sh-url' inputMode='url' value={form.url} onChange={(e) => set('url', e.target.value)} placeholder='http://192.168.31.50/' />
              {err('url')}
            </div>
          )}
          {(fields.host || fields.port) && (
            <div className='grid grid-cols-[1fr_6.5rem] gap-3'>
              <div className='space-y-1.5'>
                <Label htmlFor='sh-host'>Адрес (IP или имя)</Label>
                <Input id='sh-host' value={form.host} onChange={(e) => set('host', e.target.value)} placeholder='192.168.31.50' autoCapitalize='none' autoCorrect='off' spellCheck={false} />
                {err('host')}
              </div>
              {fields.port && (
                <div className='space-y-1.5'>
                  <Label htmlFor='sh-port'>Порт</Label>
                  <Input id='sh-port' inputMode='numeric' value={form.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder={form.kind === 'homeassistant' ? '8123' : '80'} />
                  {err('port')}
                </div>
              )}
            </div>
          )}

          <div className='space-y-1.5'>
            <Label htmlFor='sh-notes'>Заметка</Label>
            <Textarea id='sh-notes' rows={2} value={form.notes} maxLength={300} onChange={(e) => set('notes', e.target.value)} />
            {err('notes')}
          </div>

          <div className='flex items-center justify-between gap-3 rounded-lg border p-3'>
            <Label htmlFor='sh-enabled' className='font-normal'>
              Следить за доступностью
            </Label>
            <Switch id='sh-enabled' checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} />
          </div>

          {serverError && <p className='text-sm text-danger-foreground'>{serverError}</p>}
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose} disabled={save.isPending}>
              Отмена
            </Button>
            <Button type='submit' disabled={save.isPending}>
              {save.isPending ? 'Сохраняю…' : editing ? 'Сохранить' : 'Добавить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------- содержимое страницы (внутри Page: нужен режим изменения порядка) ----------
function Devices({ devices, room, setRoom, onAdd, onEdit, onDelete }: { devices: SmartDevice[]; room: string; setRoom: (r: string) => void; onAdd: (f?: Partial<DeviceForm>) => void; onEdit: (d: SmartDevice) => void; onDelete: (d: SmartDevice) => void }) {
  const editing = Boolean(useLayoutEdit()?.editing)
  const { rooms, hasNoRoom } = roomsOf(devices)
  // В режиме изменения порядка показываются все карточки: порядок хранится общим списком, а не по комнатам
  const active = rooms.includes(room) || room === ALL_ROOMS || (room === NO_ROOM && hasNoRoom) ? room : ALL_ROOMS
  const shown = editing ? devices : filterByRoom(devices, active)

  if (devices.length === 0) {
    return (
      <Card className='mx-auto max-w-3xl'>
        <CardContent className='flex flex-col items-center gap-6 px-6 py-10 text-center'>
          <div className='flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground'>
            <Lightbulb className='size-8' />
          </div>
          <div className='space-y-1.5'>
            <h2 className='text-2xl font-semibold'>Добавьте первое устройство</h2>
            <p className='text-muted-foreground'>Лампы, розетки, камеры: панель покажет, какие из них сейчас в сети, и откроет их веб-интерфейс.</p>
          </div>
          <Button size='lg' onClick={() => onAdd()}>
            <Plus /> Добавить устройство
          </Button>
          <div className='grid w-full gap-3 sm:grid-cols-3'>
            {EXAMPLES.map((ex) => (
              <button key={ex.title} type='button' onClick={() => onAdd(ex.form)} className='rounded-xl border p-4 text-left transition-colors hover:bg-muted/60'>
                <div className='font-medium'>{ex.title}</div>
                <div className='mt-1 text-xs text-muted-foreground'>{ex.hint}</div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  const blocks: Block[] = shown.map((d) => ({ id: deviceBlockId(d.id), title: d.name, node: <DeviceCard d={d} onEdit={onEdit} onDelete={onDelete} /> }))
  return (
    <div className='space-y-4'>
      {!editing && (rooms.length > 0 || hasNoRoom) && (
        <div className='flex flex-wrap gap-2' role='tablist' aria-label='Комнаты'>
          {[{ id: ALL_ROOMS, label: 'Все' }, ...rooms.map((r) => ({ id: r, label: r })), ...(hasNoRoom && rooms.length > 0 ? [{ id: NO_ROOM, label: 'Без комнаты' }] : [])].map((c) => (
            <button
              key={c.id}
              type='button'
              role='tab'
              aria-selected={active === c.id}
              onClick={() => setRoom(c.id)}
              className={cn('min-h-9 rounded-full border px-3.5 text-sm transition-colors', active === c.id ? 'border-info bg-info/10 font-medium' : 'text-muted-foreground hover:bg-muted/60')}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <SortableBlocks grid stable blocks={blocks} className='grid gap-4 md:grid-cols-2 xl:grid-cols-3' />
    </div>
  )
}

export function SmartHome() {
  const qc = useQueryClient()
  const [room, setRoom] = useState(ALL_ROOMS)
  const [dialog, setDialog] = useState<{ editing: SmartDevice | null; initial: DeviceForm; key: number } | null>(null)
  const [toDelete, setToDelete] = useState<SmartDevice | null>(null)

  const { data, isError, isPending } = useQuery({
    queryKey: ['smarthome'],
    queryFn: async () => (await api.get<DevicesResponse>('/smarthome/devices')).data,
    // Состояния обновляются раз в 30 с, пока вкладка открыта; пока идёт первая проверка — чаще
    refetchInterval: (q) => (q.state.data?.devices.some((d) => d.status.state === 'checking') ? 2000 : 30_000),
  })
  const devices = data?.devices ?? []

  const remove = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/smarthome/devices/${id}`)).data,
    onSuccess: () => {
      toast.success('Устройство удалено')
      setToDelete(null)
      qc.invalidateQueries({ queryKey: ['smarthome'] })
    },
    onError: (e) => {
      toast.error(apiError(e).message ?? 'не удалось удалить')
      setToDelete(null)
    },
  })

  const openDialog = (editing: SmartDevice | null, patch?: Partial<DeviceForm>) =>
    setDialog({ editing, initial: editing ? toForm(editing) : { ...emptyForm(), ...patch }, key: Date.now() })
  const canAdd = devices.length < MAX_DEVICES

  return (
    <Page
      title='Умный дом'
      description={data ? summaryText(devices) : isError ? 'Не удалось получить список' : 'Загружаю…'}
      layoutPage={SMARTHOME_LAYOUT_PAGE}
      actions={
        <Button onClick={() => openDialog(null)} disabled={!canAdd}>
          <Plus /> Добавить устройство
        </Button>
      }
    >
      {isError && <p className='mb-4 text-sm text-danger-foreground'>Не удалось получить список устройств.</p>}
      {!isPending && !isError && <Devices devices={devices} room={room} setRoom={setRoom} onAdd={(f) => openDialog(null, f)} onEdit={(d) => openDialog(d)} onDelete={setToDelete} />}

      {dialog && <DeviceDialog key={dialog.key} open editing={dialog.editing} initial={dialog.initial} rooms={roomsOf(devices).rooms} onClose={() => setDialog(null)} />}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && !remove.isPending && setToDelete(null)}
        title={`Удалить «${toDelete?.name ?? ''}»?`}
        desc={<p>Устройство исчезнет из списка панели. Само устройство не затрагивается.</p>}
        confirmText='Удалить'
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => toDelete && remove.mutate(toDelete.id)}
      />
    </Page>
  )
}
