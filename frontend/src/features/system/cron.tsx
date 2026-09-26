import { useQuery } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDateTime, formatRelative } from '@/lib/format'
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
        <p key={e} className='flex items-center gap-2 text-sm text-yellow-700 dark:text-yellow-400'>
          <TriangleAlert className='size-4' /> {e}
        </p>
      ))}
      <div className='overflow-x-auto rounded-md border'>
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
                      <div className='text-xs text-muted-foreground'>{formatRelative(j.next)}</div>
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
                      <div className='text-xs text-muted-foreground'>{formatRelative(j.lastRun)}</div>
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
