import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import type { InternetStatus } from '@/features/infra-types'
import { NoData } from '@/components/no-data'
import { StatusBadge } from '@/components/status-badge'
import { Value } from '@/components/value'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

// Интернет: в норме — свёрнут в одну строку; при обрыве раскрывается сам
export function InternetCard({ data, isError }: { data: InternetStatus | undefined; isError: boolean }) {
  const [open, setOpen] = useState(false)
  const down = data?.downSince ?? null
  const attention = Boolean(down) || isError
  const expanded = attention || open
  const ms = data?.now?.main
  return (
    <Card className='gap-2 py-3'>
      <Collapsible open={expanded} onOpenChange={setOpen}>
        <CardHeader className='flex flex-row items-center justify-between gap-2 px-4'>
          <CardTitle className='text-sm font-medium'>Интернет</CardTitle>
          <div className='flex min-w-0 items-center gap-2'>
            {isError ? (
              <StatusBadge status='unknown' />
            ) : !data ? (
              <span className='text-sm text-muted-foreground'>Загрузка…</span>
            ) : down ? (
              <StatusBadge status='error' />
            ) : (
              <StatusBadge status='ok' label={ms != null ? `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} мс` : undefined} />
            )}
            {!attention && (
              <Button variant='ghost' size='sm' onClick={() => setOpen((v) => !v)} aria-expanded={expanded}>
                {expanded ? 'Свернуть' : 'Подробнее'}
                <ChevronDown className={cn('transition-transform', expanded && 'rotate-180')} />
              </Button>
            )}
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className='px-4 pt-0'>
            {isError ? (
              <NoData reason='бэкенд не ответил' />
            ) : !data ? null : (
              <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm'>
                {down && (
                  <>
                    <dt className='text-muted-foreground'>Нет связи с</dt>
                    <dd className='text-danger-foreground'>{formatDateTime(down)}</dd>
                  </>
                )}
                <dt className='text-muted-foreground'>Внешний IP</dt>
                <dd>{data.ip ? <Value kind='address' value={data.ip.ip} /> : <NoData />}</dd>
                <dt className='text-muted-foreground'>Средний пинг за сутки</dt>
                <dd>{data.targetDay.main.avgMs != null ? <Value kind='number' value={`${data.targetDay.main.avgMs} мс`} /> : <NoData />}</dd>
                <dt className='text-muted-foreground'>Потери за неделю</dt>
                <dd>{data.week.lossPct != null ? <Value kind='number' value={`${data.week.lossPct}%`} /> : <NoData />}</dd>
                <dt className='text-muted-foreground'>Обрывов записано</dt>
                <dd>
                  <Value kind='count' value={data.outages.length} />
                </dd>
              </dl>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
