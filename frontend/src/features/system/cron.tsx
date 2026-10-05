import { useQuery } from '@tanstack/react-query'
import { Value } from '@/components/value'
import { TriangleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { CronJob } from '@/lib/types'
import { NoData } from '@/components/no-data'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function Result({ job }: { job: CronJob }) {
  if (!job.lastResult) return <NoData />
  if (job.lastResult.startsWith('ошибка')) return <StatusBadge status='error' label={job.lastResult} />
  if (job.lastResult === 'успешно') return <StatusBadge status='ok' label='успешно' />
  return <span className='text-sm text-muted-foreground'>{job.lastResult}</span>
}

export function Cron() {
  const { data, isError } = useQuery({
    queryKey: ['cron'],
    queryFn: async () => (await api.get<{ jobs: CronJob[]; errors: string[] }>('/system/cron')).data,
    refetchInterval: 60_000,
  })
  if (isError) return <NoData reason='не удалось получить задачи' />

  return (
    <div className='space-y-3'>
      {data?.errors.map((e) => (
        <p key={e} className='flex items-center gap-2 text-sm text-warn-foreground'>
          <TriangleAlert className='size-4' /> {e}
        </p>
      ))}
      {/* Телефон: карточки вместо таблицы (таблица шире экрана) */}
      <ul className='space-y-2 sm:hidden'>
        {(data?.jobs ?? []).map((j, i) => (
          <li key={`${j.source}-${i}`} className='space-y-1 rounded-md border p-3 text-sm'>
            <div className='flex items-start justify-between gap-2'>
              <div className='min-w-0'>
                <div className='font-medium'>
                  {j.kind === 'timer' ? <Badge variant='secondary' className='me-1.5'>таймер</Badge> : null}
                  {j.kind === 'timer' ? j.schedule : j.human}
                </div>
                {j.kind === 'cron' && j.human !== j.schedule && <code className='text-xs text-muted-foreground'>{j.schedule}</code>}
              </div>
              <Result job={j} />
            </div>
            <div className='flex flex-wrap gap-x-3 text-xs text-muted-foreground'>
              <span>
                дальше:{' '}
                {j.next ? <span className='tabular-nums text-foreground'>{formatDateTime(j.next)}</span> : j.schedule === '@reboot' ? 'при загрузке' : '—'}
              </span>
              {j.lastRun && <span>был: <span className='tabular-nums'>{formatDateTime(j.lastRun)}</span></span>}
            </div>
            <code className='line-clamp-3 block text-xs break-all text-muted-foreground'>{j.command}</code>
          </li>
        ))}
      </ul>
      <div className='hidden overflow-x-auto rounded-md border sm:block'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Следующий запуск</TableHead>
              <TableHead>Расписание</TableHead>
              <TableHead>Команда</TableHead>
              <TableHead className='hidden md:table-cell'>Кто</TableHead>
              <TableHead className='hidden sm:table-cell'>Последний запуск</TableHead>
              <TableHead className='hidden sm:table-cell'>Результат</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.jobs ?? []).map((j, i) => (
              <TableRow key={`${j.source}-${i}`}>
                <TableCell className='whitespace-nowrap'>
                  {j.next ? (
                    <>
                      <div className='tabular-nums'>{formatDateTime(j.next)}</div>
                      <Value kind='ago' value={j.next} className='text-xs' />
                    </>
                  ) : (
                    <span className='text-muted-foreground'>{j.schedule === '@reboot' ? 'при загрузке' : '—'}</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className='flex items-center gap-2'>
                    {j.kind === 'timer' ? <Badge variant='secondary'>таймер</Badge> : null}
                    <span>{j.kind === 'timer' ? j.schedule : j.human}</span>
                  </div>
                  {j.kind === 'cron' && j.human !== j.schedule && (
                    <code className='text-xs text-muted-foreground'>{j.schedule}</code>
                  )}
                </TableCell>
                <TableCell className='max-w-[28rem]'>
                  <code className='line-clamp-2 text-xs break-all' title={j.command}>
                    {j.command}
                  </code>
                </TableCell>
                <TableCell className='hidden text-sm md:table-cell'>
                  {j.user}
                  <div className='text-xs text-muted-foreground'>{j.source}</div>
                </TableCell>
                <TableCell className='hidden whitespace-nowrap sm:table-cell'>
                  {j.lastRun ? (
                    <>
                      <div className='tabular-nums'>{formatDateTime(j.lastRun)}</div>
                      <Value kind='ago' value={j.lastRun} className='text-xs' />
                    </>
                  ) : (
                    <NoData reason={j.kind === 'cron' ? 'нет записи в журнале за 8 дней' : undefined} />
                  )}
                </TableCell>
                <TableCell className='hidden sm:table-cell'>
                  <Result job={j} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className='text-xs text-muted-foreground'>
        Для cron-задач журнал фиксирует только факт запуска («запущено»), код завершения доступен лишь для systemd-таймеров.
      </p>
    </div>
  )
}
