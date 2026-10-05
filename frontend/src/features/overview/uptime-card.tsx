// Этап 10 (п.2): «Доступность сервисов» на Обзоре. Сбои видны всегда, спокойные сервисы — свёрнуты по кнопке.
import { useState } from 'react'
import type { MonitorBars } from '@/features/infra-types'
import { useUptime } from '@/lib/uptime'
import { UptimeBars } from '@/components/uptime-bars'
import { NoData } from '@/components/no-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

// Был ли сбой за неделю (любой интервал с простоем): такие сервисы показываем всегда
const hasIssue = (m: MonitorBars) =>
  (m.upDay != null && m.upDay < 100) ||
  (m.upWeek != null && m.upWeek < 100) ||
  m.day.some((b) => b.status === 'partial' || b.status === 'down') ||
  m.week.some((b) => b.status === 'partial' || b.status === 'down')

function MonitorRow({ m, problem }: { m: MonitorBars; problem: boolean }) {
  return (
    <div className={cn('rounded-md px-2 py-1.5', problem ? 'bg-warn/5' : '')}>
      <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5'>
        <span className={cn('truncate text-xs', problem ? 'font-medium text-foreground' : 'text-muted-foreground')}>{m.title}</span>
        <span className='text-[11px] tabular-nums text-muted-foreground'>
          24 ч <span className={cn(m.upDay != null && m.upDay < 100 && 'text-warn-foreground font-medium')}>{m.upDay != null ? `${m.upDay}%` : '—'}</span>
          <span className='mx-1.5'>·</span>
          7 дн <span className={cn(m.upWeek != null && m.upWeek < 100 && 'text-warn-foreground font-medium')}>{m.upWeek != null ? `${m.upWeek}%` : '—'}</span>
        </span>
      </div>
      <div className='mt-1 grid gap-x-3 gap-y-0.5 sm:grid-cols-2'>
        <UptimeBars bars={m.day} granularity='hour' className='h-1' quiet />
        <UptimeBars bars={m.week} granularity='day' className='h-1' quiet />
      </div>
    </div>
  )
}

export function UptimeCard() {
  const { data, isError } = useUptime()
  const [showAll, setShowAll] = useState(false)
  const monitors = data?.monitors ?? []
  const problems = monitors.filter(hasIssue).sort((a, b) => (a.upDay ?? 100) - (b.upDay ?? 100))
  const calm = monitors.filter((m) => !hasIssue(m))
  // Сводка за 24 ч: сколько сервисов без единого сбоя и сколько с провалами
  const ok24 = monitors.filter((m) => m.upDay === 100).length
  const fail24 = monitors.filter((m) => m.upDay != null && m.upDay < 100).length

  return (
    <Card className='gap-2 py-3'>
      <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-2 px-4'>
        <CardTitle className='text-sm font-medium'>Доступность сервисов</CardTitle>
        {data && (
          <span className='text-xs text-muted-foreground tabular-nums'>
            за 24 ч: <span className='text-foreground'>{ok24}</span> без сбоев
            {fail24 > 0 && (
              <>
                {' · '}
                <span className='font-medium text-warn-foreground'>{fail24} с провалами</span>
              </>
            )}
          </span>
        )}
      </CardHeader>
      <CardContent className='space-y-2 px-4'>
        {isError ? (
          <NoData reason='бэкенд не ответил' />
        ) : !data ? (
          <span className='text-sm text-muted-foreground'>Загрузка…</span>
        ) : (
          <>
            {problems.length > 0 ? (
              <div className='space-y-1'>
                {problems.map((m) => (
                  <MonitorRow key={m.id} m={m} problem />
                ))}
              </div>
            ) : (
              <p className='text-xs text-muted-foreground'>за неделю сбоев не было</p>
            )}
            {calm.length > 0 && (
              <div className='border-t pt-2'>
                <button
                  type='button'
                  onClick={() => setShowAll((v) => !v)}
                  className='flex w-full items-center justify-between text-xs text-muted-foreground transition-colors hover:text-foreground'
                >
                  <span>Без сбоев за неделю: {calm.length}</span>
                  <span>{showAll ? 'скрыть' : 'показать'}</span>
                </button>
                {showAll && (
                  <div className='mt-1.5 space-y-0.5'>
                    {calm.map((m) => (
                      <MonitorRow key={m.id} m={m} problem={false} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
