import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Group } from '@/lib/smarthome'
import { cn } from '@/lib/utils'
import { GROUP_ICON } from './icons'

// Один ввод названия: переименование устройства или блока, новый блок
export function NameDialog({ title, description, initial, label = 'Название', max, confirmText, pending, error, onSubmit, onClose }: {
  title: string
  description?: string
  initial: string
  label?: string
  max: number
  confirmText: string
  pending: boolean
  error: string | null
  onSubmit: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial)
  const [local, setLocal] = useState<string | null>(null)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const v = name.trim()
    if (v.length < 1 || v.length > max) return setLocal(`${label}: от 1 до ${max} символов`)
    setLocal(null)
    onSubmit(v)
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className='sm:max-w-sm'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={submit} className='space-y-3' noValidate>
          <Label htmlFor='sh-name-only'>{label}</Label>
          <Input id='sh-name-only' value={name} maxLength={max} autoFocus onChange={(e) => setName(e.target.value)} />
          {(local || error) && <p className='text-sm text-danger-foreground'>{local ?? error}</p>}
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose} disabled={pending}>
              Отмена
            </Button>
            <Button type='submit' disabled={pending}>
              {pending ? 'Сохраняю…' : confirmText}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// «Переместить в группу…»: любой существующий блок или новый
export function MoveDialog({ deviceName, groups, current, pending, error, onPick, onNew, onClose }: {
  deviceName: string
  groups: Group[]
  current: string
  pending: boolean
  error: string | null
  onPick: (groupId: string) => void
  onNew: () => void
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-sm'>
        <DialogHeader>
          <DialogTitle>Переместить в группу</DialogTitle>
          <DialogDescription>«{deviceName}»: выберите блок на странице.</DialogDescription>
        </DialogHeader>
        <div className='space-y-1.5' role='radiogroup' aria-label='Группа'>
          {groups.map((g) => {
            const Icon = GROUP_ICON[g.icon] ?? GROUP_ICON.box
            return (
              <button key={g.id} type='button' role='radio' aria-checked={g.id === current} disabled={pending || g.id === current} onClick={() => onPick(g.id)}
                className={cn('flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 text-left text-sm transition-colors hover:bg-muted/60 disabled:opacity-100', g.id === current && 'border-info bg-info/10')}>
                <Icon className='size-4 shrink-0 text-muted-foreground' />
                <span className='truncate'>{g.name}</span>
                {g.id === current && <span className='ms-auto text-xs text-muted-foreground'>сейчас здесь</span>}
              </button>
            )
          })}
          <Button type='button' variant='outline' className='w-full' disabled={pending} onClick={onNew}>
            Новая группа…
          </Button>
        </div>
        {error && <p className='text-sm text-danger-foreground'>{error}</p>}
      </DialogContent>
    </Dialog>
  )
}
