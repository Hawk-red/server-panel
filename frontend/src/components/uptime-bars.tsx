// Этап 10 (п.2): полоски доступности сервисов, как в Uptime Kuma
import type { BarStatus, MonitorBars, UptimeBar } from '@/features/infra-types'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

export const BAR_COLOR: Record<BarStatus, string> = {
  up: 'bg-ok',
  partial: 'bg-warn',
  down: 'bg-danger',
  unknown: 'bg-muted-foreground/20',
}
const STATUS_LABEL: Record<BarStatus, string> = {
  up: 'работал без перебоев',
  partial: 'были сбои',
  down: 'не работал',
  unknown: 'нет данных',
}

function barLabel(bar: UptimeBar, granularity: 'hour' | 'day'): string {
  const start = new Date(bar.ts)
  const end = new Date(bar.ts + (granularity === 'hour' ? 3_600_000 : 86_400_000))
  const fmt = granularity === 'hour' ? (x: Date) => x.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : (x: Date) => x.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  const range = `${fmt(start)}–${fmt(end)}`
  const pct = bar.status === 'partial' || bar.status === 'down' ? ` · простой ${bar.downPct}%` : ''
  return `${range}: ${STATUS_LABEL[bar.status]}${pct}`
}

type UptimeBarsProps = { bars: UptimeBar[]; granularity: 'hour' | 'day'; className?: string }

// Ряд полосок-баров с подсказкой по каждому интервалу
export function UptimeBars({ bars, granularity, className }: UptimeBarsProps) {
  return (
    <div className={cn('flex items-stretch gap-0.5', className)}>
      {bars.map((b) => (
        <Tooltip key={b.ts}>
          <TooltipTrigger asChild>
            <div className={cn('flex-1 rounded-[2px]', BAR_COLOR[b.status])} />
          </TooltipTrigger>
          <TooltipContent>{barLabel(b, granularity)}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

// Компактный блок для карточек сервисов: заголовок «24 ч», процент и сами бары
export function UptimeStrip({ monitor }: { monitor: MonitorBars | undefined }) {
  if (!monitor) return null
  return (
    <div className='space-y-1'>
      <div className='flex items-center justify-between text-xs text-muted-foreground'>
        <span>Доступность за 24 ч</span>
        {monitor.upDay != null && <span className='font-medium text-foreground'>{monitor.upDay}%</span>}
      </div>
      <UptimeBars bars={monitor.day} granularity='hour' className='h-4' />
    </div>
  )
}
