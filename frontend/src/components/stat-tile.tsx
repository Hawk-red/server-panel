import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Direction } from '@/lib/levels'
import { Meter } from './meter'
import { NoData } from './no-data'

type StatTileProps = {
  title: string
  icon?: React.ElementType
  value: React.ReactNode | null
  sub?: React.ReactNode
  percent?: number | null
  /** как красить полоску: больше = хуже (по умолчанию), больше = лучше, нейтрально */
  direction?: Direction
  noDataReason?: string | null
  className?: string
}

// Плитка метрики: значение, подпись и (опционально) полоска заполненности
export function StatTile({ title, icon: Icon, value, sub, percent, direction, noDataReason, className }: StatTileProps) {
  return (
    <Card className={cn('gap-2', className)}>
      <CardHeader className='flex flex-row items-center justify-between space-y-0'>
        <CardTitle className='text-sm font-medium'>{title}</CardTitle>
        {Icon && <Icon className='size-4 text-muted-foreground' />}
      </CardHeader>
      <CardContent className='space-y-2'>
        {value == null ? (
          noDataReason === null ? (
            <span className='text-lg text-muted-foreground'>сбор данных…</span>
          ) : (
            <NoData reason={noDataReason} className='text-lg' />
          )
        ) : (
          <div className='text-xl font-bold break-words tabular-nums sm:text-2xl xl:text-xl 2xl:text-2xl'>{value}</div>
        )}
        {sub && <div className='text-xs text-muted-foreground'>{sub}</div>}
        {percent != null && <Meter value={percent} direction={direction} label={title} />}
      </CardContent>
    </Card>
  )
}
