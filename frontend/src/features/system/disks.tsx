import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatBytes, formatPercent, formatRelative } from '@/lib/format'
import type { DiskInfo } from '@/lib/types'
import { cn } from '@/lib/utils'
import { NoData } from '@/components/no-data'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function SmartCell({ d }: { d: DiskInfo }) {
  const s = d.smart
  if (!s) return <NoData reason='SMART ещё не опрашивался' />
  if (s.status === 'ok') return <StatusBadge status='ok' label='SMART в норме' />
  if (s.status === 'failing') return <StatusBadge status='error' label='SMART: неисправен' />
  if (s.status === 'standby') return <StatusBadge status='unknown' label='спит (не будим)' />
  return <NoData reason={s.error} />
}

export function Disks() {
  const qc = useQueryClient()
  const { data, isError } = useQuery({
    queryKey: ['disks'],
    queryFn: async () => (await api.get<DiskInfo[]>('/system/disks')).data,
    refetchInterval: 30_000,
  })
  const refresh = useMutation({
    mutationFn: async () => (await api.post<DiskInfo[]>('/system/disks/smart-refresh', {})).data,
    onSuccess: (d) => {
      qc.setQueryData(['disks'], d)
      toast.success('SMART обновлён')
    },
  })

  if (isError) return <NoData reason='не удалось получить список дисков' />

  return (
    <div className='space-y-4'>
      <div className='flex justify-end'>
        <Button size='sm' variant='outline' onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          <RefreshCw className={cn(refresh.isPending && 'animate-spin')} /> Обновить SMART
        </Button>
      </div>
      <div className='grid gap-4 md:grid-cols-2'>
        {(data ?? []).map((d) => (
          <Card key={d.device} className={cn('gap-2', d.state === 'missing' && 'border-red-500/50')}>
            <CardHeader className='flex flex-row items-start justify-between gap-2'>
              <div>
                <CardTitle className='text-base'>{d.mount ?? d.device}</CardTitle>
                <p className='text-xs text-muted-foreground'>
                  {[d.model, d.label && `метка ${d.label}`, d.transport?.toUpperCase()].filter(Boolean).join(' · ') || d.device}
                </p>
              </div>
              {d.state === 'missing' ? (
                <StatusBadge status='error' label='отвалился' />
              ) : d.state === 'unmounted' ? (
                <StatusBadge status='warning' label='не смонтирован' />
              ) : (
                <StatusBadge status={d.percent != null && d.percent > 85 ? 'warning' : 'ok'} label='смонтирован' />
              )}
            </CardHeader>
            <CardContent className='space-y-2 text-sm'>
              {d.percent != null && (
                <>
                  <div className='flex justify-between tabular-nums'>
                    <span>
                      {formatBytes(d.used)} занято · {formatBytes(d.free)} свободно
                    </span>
                    <span className={cn('font-medium', d.percent > 85 && 'text-yellow-600', d.percent >= 90 && 'text-red-600')}>
                      {formatPercent(d.percent)}
                    </span>
                  </div>
                  <div className='h-2 overflow-hidden rounded-full bg-muted'>
                    <div
                      className={cn('h-full rounded-full', d.percent >= 90 ? 'bg-red-500' : d.percent > 85 ? 'bg-yellow-500' : 'bg-primary')}
                      style={{ width: `${d.percent}%` }}
                    />
                  </div>
                </>
              )}
              <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground'>
                <dt>Устройство</dt>
                <dd className='text-foreground'>{d.device}</dd>
                <dt>ФС / размер</dt>
                <dd className='text-foreground'>
                  {d.fstype ?? '—'} · {d.size ? formatBytes(d.size) : '—'}
                </dd>
                <dt>SMART</dt>
                <dd>
                  <SmartCell d={d} />
                </dd>
                <dt>Температура</dt>
                <dd className='text-foreground'>{d.smart?.temperature != null ? `${d.smart.temperature} °C` : <NoData />}</dd>
                {d.smart?.powerOnHours != null && (
                  <>
                    <dt>Наработка</dt>
                    <dd className='text-foreground'>{Math.round(d.smart.powerOnHours / 24)} дней</dd>
                  </>
                )}
                {d.smart && (
                  <>
                    <dt>Проверено</dt>
                    <dd className='text-foreground'>{formatRelative(d.smart.checkedAt)}</dd>
                  </>
                )}
                <dt>fstab</dt>
                <dd className='text-foreground'>{d.inFstab ? 'да' : 'нет'}</dd>
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
