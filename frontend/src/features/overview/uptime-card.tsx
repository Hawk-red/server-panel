// Этап 10 (п.2): «Доступность сервисов» на Обзоре — полоски 24 ч / 7 дней по всем службам, контейнерам и сайтам
import type { MonitorBars } from '@/features/infra-types'
import { useUptime } from '@/lib/uptime'
import { BAR_COLOR, UptimeBars } from '@/components/uptime-bars'
import { NoData } from '@/components/no-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

function MonitorRow({ m }: { m: MonitorBars }) {
  const latest = m.day[m.day.length - 1]
  return (
    <div className='space-y-0.5 py-0.5 first:pt-0 last:pb-0'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex items-center gap-2 text-xs leading-tight font-medium'>
          <span className={cn('size-2 shrink-0 rounded-full', BAR_COLOR[latest?.status ?? 'unknown'])} aria-hidden='true' />
          {m.title}
        </div>
        <div className='flex gap-3 text-[11px] leading-tight text-muted-foreground tabular-nums'>
          <span>24 ч: {m.upDay != null ? `${m.upDay}%` : '—'}</span>
          <span>7 дн: {m.upWeek != null ? `${m.upWeek}%` : '—'}</span>
        </div>
      </div>
      {/* 24 ч и 7 дней — рядом (слева 24 ч, справа 7 дн), на узком экране друг под другом */}
      <div className='grid gap-x-3 gap-y-0.5 sm:grid-cols-2'>
        <UptimeBars bars={m.day} granularity='hour' className='h-[6px]' />
        <UptimeBars bars={m.week} granularity='day' className='h-[6px]' />
      </div>
    </div>
  )
}

const GROUP_ORDER = ['Сервер', 'Сайты и API', 'Службы', 'Контейнеры']

export function UptimeCard() {
  const { data, isError } = useUptime()
  const groups = new Map<string, MonitorBars[]>()
  for (const m of data?.monitors ?? []) groups.set(m.group, [...(groups.get(m.group) ?? []), m])

  return (
    <Card className='gap-1 py-4'>
      <CardHeader>
        <CardTitle className='text-sm font-medium'>Доступность сервисов</CardTitle>
      </CardHeader>
      <CardContent>
        {isError ? (
          <NoData reason='бэкенд не ответил' />
        ) : !data ? (
          <span className='text-sm text-muted-foreground'>Загрузка…</span>
        ) : (
          <div className='space-y-1.5'>
            {GROUP_ORDER.filter((g) => groups.has(g)).map((g) => (
              <div key={g}>
                <div className='mb-0.5 text-[11px] leading-tight font-medium text-muted-foreground uppercase'>{g}</div>
                <div className='divide-y'>
                  {groups.get(g)!.map((m) => (
                    <MonitorRow key={m.id} m={m} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
