import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AxiosError } from 'axios'
import { OctagonX, Play, RotateCw, ScrollText } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { ConfirmDialog } from './confirm-dialog'
import { Button } from './ui/button'

type Action = 'start' | 'stop' | 'restart'
const LABEL: Record<Action, string> = { start: 'Запустить', stop: 'Остановить', restart: 'Перезапустить' }

type UnitControlsProps = {
  unit: string
  title: string
  active: boolean
  warning?: React.ReactNode
  invalidate?: string[]
  labels?: Partial<Record<Action, string>>
}

// Кнопки systemd-службы (белый список на бэкенде) с подтверждением последствий
export function UnitControls({ unit, title, active, warning, invalidate = [], labels = {} }: UnitControlsProps) {
  const qc = useQueryClient()
  const [pending, setPending] = useState<Action | null>(null)
  const control = useMutation({
    mutationFn: (a: Action) => api.post(`/system/services/${encodeURIComponent(unit)}/${a}`, {}),
    onSuccess: (_d, a) => {
      toast.success(`${title}: ${LABEL[a].toLowerCase()} — выполнено`)
      for (const k of invalidate) qc.invalidateQueries({ queryKey: [k] })
    },
    onError: (e) => toast.error(`${title}: ${(e instanceof AxiosError && e.response?.data?.message) || 'ошибка'}`),
    onSettled: () => setPending(null),
  })
  const label = (a: Action) => labels[a] ?? LABEL[a]

  return (
    <div className='flex flex-wrap gap-2'>
      {active ? (
        <Button size='sm' variant='destructive' onClick={() => setPending('stop')}>
          <OctagonX /> {label('stop')}
        </Button>
      ) : (
        <Button size='sm' variant='outline' onClick={() => setPending('start')}>
          <Play /> {label('start')}
        </Button>
      )}
      <Button size='sm' variant='outline' onClick={() => setPending('restart')}>
        <RotateCw /> {label('restart')}
      </Button>
      <Button size='sm' variant='ghost' asChild>
        <Link to='/system' search={{ tab: 'logs', source: `journal:${unit}` }}>
          <ScrollText /> Логи
        </Link>
      </Button>
      {pending && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && !control.isPending && setPending(null)}
          title={`${label(pending)}: ${title}?`}
          desc={<div className='space-y-2'>{pending !== 'start' && warning ? <div className='font-medium text-danger-foreground'>⚠ {warning}</div> : <p>Служба {unit}.</p>}</div>}
          confirmText={label(pending)}
          destructive={pending !== 'start'}
          isLoading={control.isPending}
          handleConfirm={() => control.mutate(pending)}
        />
      )}
    </div>
  )
}
