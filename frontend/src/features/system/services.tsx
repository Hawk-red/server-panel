import { useState } from 'react'
import { Value } from '@/components/value'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AxiosError } from 'axios'
import { ChevronDown, OctagonX, Play, RotateCw, ScrollText } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { ServiceRow } from '@/lib/types'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { NoData } from '@/components/no-data'
import { StatusBadge, unitStatus } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type Action = 'start' | 'stop' | 'restart'
const ACTION_LABEL: Record<Action, string> = { start: 'Запустить', stop: 'Остановить', restart: 'Перезапустить' }

function statusLabel(s: ServiceRow) {
  if (s.active === 'active') return s.sub === 'running' ? 'работает' : s.sub === 'exited' ? 'выполнена' : s.sub
  if (s.active === 'failed') return 'упала'
  if (s.active === 'inactive') return 'остановлена'
  return s.active
}

function ServicesTable({ rows, onAction }: { rows: ServiceRow[]; onAction: (s: ServiceRow, a: Action) => void }) {
  return (
    <div className='overflow-x-auto rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Служба</TableHead>
            <TableHead className='hidden sm:table-cell'>Статус</TableHead>
            <TableHead className='hidden md:table-cell'>Работает</TableHead>
            <TableHead className='hidden lg:table-cell' title='Память cgroup, включая файловый кэш'>
              Память
            </TableHead>
            <TableHead className='hidden sm:table-cell'>Автозапуск</TableHead>
            <TableHead className='text-end'>Действия</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((s) => (
            <TableRow key={s.unit}>
              <TableCell className='max-w-[10rem] sm:max-w-[18rem]'>
                <div className='truncate font-medium'>{s.unit.replace(/\.service$/, '')}</div>
                <div className='truncate text-xs text-muted-foreground'>{s.description}</div>
                <StatusBadge className='mt-1 sm:hidden' status={s.active === 'inactive' ? 'unknown' : unitStatus(s.active)} label={statusLabel(s)} />
              </TableCell>
              <TableCell className='hidden sm:table-cell'>
                <StatusBadge status={s.active === 'inactive' ? 'unknown' : unitStatus(s.active)} label={statusLabel(s)} />
              </TableCell>
              <TableCell className='hidden whitespace-nowrap md:table-cell'>
                {s.since ? <Value kind='duration' value={Math.round((Date.now() - s.since) / 1000)} /> : '—'}
              </TableCell>
              <TableCell className='hidden lg:table-cell'>{s.memory ? <Value kind='bytes' value={s.memory} /> : '—'}</TableCell>
              <TableCell className='hidden sm:table-cell'>{s.enabled ?? '—'}</TableCell>
              <TableCell>
                <div className='flex justify-end gap-1'>
                  {s.controllable && (
                    <>
                      {s.active !== 'active' ? (
                        <Button size='icon' variant='ghost' title='Запустить' onClick={() => onAction(s, 'start')}>
                          <Play />
                        </Button>
                      ) : (
                        <Button size='icon' variant='destructive' title='Остановить' aria-label='Остановить' onClick={() => onAction(s, 'stop')}>
                          <OctagonX />
                        </Button>
                      )}
                      <Button size='icon' variant='ghost' title='Перезапустить' onClick={() => onAction(s, 'restart')}>
                        <RotateCw />
                      </Button>
                    </>
                  )}
                  <Button size='icon' variant='ghost' title='Логи' asChild>
                    <Link to='/system' search={{ tab: 'logs', source: `journal:${s.unit}` }}>
                      <ScrollText />
                    </Link>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function Services() {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [pending, setPending] = useState<{ s: ServiceRow; a: Action } | null>(null)
  const { data, isError } = useQuery({
    queryKey: ['services'],
    queryFn: async () => (await api.get<ServiceRow[]>('/system/services')).data,
    refetchInterval: 10_000,
  })
  const control = useMutation({
    mutationFn: async ({ s, a }: { s: ServiceRow; a: Action }) => api.post(`/system/services/${encodeURIComponent(s.unit)}/${a}`, {}),
    onSuccess: (_d, { s, a }) => {
      toast.success(`${ACTION_LABEL[a]}: ${s.unit} — выполнено`)
      qc.invalidateQueries({ queryKey: ['services'] })
    },
    onError: (e, { s }) => {
      const msg = e instanceof AxiosError ? e.response?.data?.message : String(e)
      toast.error(`${s.unit}: ${msg ?? 'ошибка'}`)
    },
    onSettled: () => setPending(null),
  })

  if (isError) return <NoData reason='не удалось получить список служб' />
  const f = (s: ServiceRow) => !q || `${s.unit} ${s.description}`.toLowerCase().includes(q.toLowerCase())
  const rows = (data ?? []).filter(f)
  const main = rows.filter((s) => !s.background)
  const background = rows.filter((s) => s.background)

  return (
    <div className='space-y-4'>
      <Input placeholder='Фильтр по имени…' value={q} onChange={(e) => setQ(e.target.value)} className='max-w-sm' />
      <ServicesTable rows={main} onAction={(s, a) => setPending({ s, a })} />
      <p className='text-xs text-muted-foreground'>
        Кнопки управления есть только у служб из белого списка панели; ssh, WireGuard и docker появятся на этапах 3 и 5.
      </p>
      <Collapsible>
        <CollapsibleTrigger className='flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground'>
          <ChevronDown className='size-4' /> Системный фон ({background.length})
        </CollapsibleTrigger>
        <CollapsibleContent className='mt-2'>
          <ServicesTable rows={background} onAction={(s, a) => setPending({ s, a })} />
        </CollapsibleContent>
      </Collapsible>

      {pending && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && !control.isPending && setPending(null)}
          title={`${ACTION_LABEL[pending.a]} ${pending.s.unit}?`}
          desc={
            <div className='space-y-2'>
              <p>{pending.s.description}</p>
              {pending.a !== 'start' && pending.s.warning && <p className='font-medium text-danger-foreground'>⚠ {pending.s.warning}</p>}
              {pending.a === 'restart' && <p>Служба будет недоступна несколько секунд.</p>}
            </div>
          }
          confirmText={ACTION_LABEL[pending.a]}
          destructive={pending.a !== 'start'}
          isLoading={control.isPending}
          handleConfirm={() => control.mutate(pending)}
        />
      )}
    </div>
  )
}
