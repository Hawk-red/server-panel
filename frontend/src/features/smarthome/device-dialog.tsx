import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { addressFields, DEFAULT_ROOMS, type DeviceForm, ICONS, KINDS, type SmartDevice, toPayload, validateForm } from '@/lib/smarthome'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { apiError, ICON_COMPONENT } from './icons'

// ---------- окно «Добавить / изменить устройство» ----------
export function DeviceDialog({ open, editing, initial, rooms, onClose }: { open: boolean; editing: SmartDevice | null; initial: DeviceForm; rooms: string[]; onClose: () => void }) {
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

