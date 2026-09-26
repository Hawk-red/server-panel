import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NoData } from './no-data'

type StatTileProps = {
  title: string
  icon?: React.ElementType
  value: React.ReactNode | null
  sub?: React.ReactNode
  percent?: number | null
  noDataReason?: string | null
  className?: string
}

function barColor(p: number) {
  if (p >= 90) return 'bg-red-500'
  if (p >= 85) return 'bg-yellow-500'
  return 'bg-primary'
}

// Плитка метрики: значение, подпись и (опционально) полоска заполненности
export function StatTile({ title, icon: Icon, value, sub, percent, noDataReason, className }: StatTileProps) {
  return (
    <Card className={cn('gap-2', className)}>
      <CardHeader className='flex flex-row items-center justify-between space-y-0'>
        <CardTitle className='text-sm font-medium'>{title}</CardTitle>
        {Icon && <Icon className='size-4 text-muted-foreground' />}
      </CardHeader>
      <CardContent className='space-y-2'>
        {value == null ? (
          <NoData reason={noDataReason} className='text-lg' />
        ) : (
          <div className='text-2xl font-bold tabular-nums'>{value}</div>
        )}
        {sub && <div className='text-xs text-muted-foreground'>{sub}</div>}
        {percent != null && (
          <div className='h-2 w-full overflow-hidden rounded-full bg-muted'>
            <div className={cn('h-full rounded-full transition-all', barColor(percent))} style={{ width: `${Math.min(100, percent)}%` }} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
