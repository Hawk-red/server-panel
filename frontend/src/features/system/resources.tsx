import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatBps } from '@/lib/format'
import type { Range, Snapshot } from '@/lib/types'
import { cn } from '@/lib/utils'
import { MetricChart, RANGE_LABELS, type SeriesDef } from '@/components/metric-chart'
import { Button } from '@/components/ui/button'

const pct = (v: number) => `${Math.round(v)}%`
const deg = (v: number) => `${Math.round(v)} °C`

export function Resources() {
  const [range, setRange] = useState<Range>('hour')
  const [perCore, setPerCore] = useState(false)
  const { data: names } = useQuery({
    queryKey: ['metric-names'],
    queryFn: async () => (await api.get<string[]>('/metrics/names')).data,
    staleTime: 5 * 60_000,
  })
  const { data: snap } = useQuery({
    queryKey: ['snapshot'],
    queryFn: async () => (await api.get<{ snapshot: Snapshot | null }>('/system/snapshot')).data.snapshot,
    refetchInterval: 10_000,
  })

  const cores = (names ?? []).filter((n) => /^cpu\.core\d+$/.test(n))
  const cpuSeries: SeriesDef[] = perCore
    ? cores.map((n) => ({ name: n, label: `Ядро ${n.slice(8)}` }))
    : [{ name: 'cpu.total', label: 'CPU' }]
  const diskTemps: SeriesDef[] = (names ?? [])
    .filter((n) => n.startsWith('temp.disk.'))
    .map((n) => ({ name: n, label: n.slice('temp.disk.'.length) }))
  const ifaces = Object.keys(snap?.network ?? {})

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
          <Button key={r} size='sm' variant={r === range ? 'default' : 'outline'} onClick={() => setRange(r)}>
            {RANGE_LABELS[r]}
          </Button>
        ))}
        <Button size='sm' variant='ghost' className={cn('ms-auto', perCore && 'bg-muted')} onClick={() => setPerCore((v) => !v)}>
          {perCore ? 'CPU суммарно' : 'CPU по ядрам'}
        </Button>
      </div>
      <div className='grid gap-4 lg:grid-cols-2'>
        <MetricChart title='Загрузка CPU' series={cpuSeries} range={range} format={pct} domain={[0, 100]} />
        <MetricChart title='Load average (1 мин)' series={[{ name: 'load.1', label: 'Load 1m' }]} range={range} format={(v) => v.toFixed(2)} domain={[0, 'auto']} />
        <MetricChart
          title='Память и swap'
          series={[
            { name: 'mem.used_pct', label: 'RAM' },
            { name: 'swap.used_pct', label: 'Swap' },
          ]}
          range={range}
          format={pct}
          domain={[0, 100]}
        />
        <MetricChart
          title='Температура'
          series={[{ name: 'temp.cpu', label: 'CPU' }, ...diskTemps]}
          range={range}
          format={deg}
        />
        <MetricChart title='Вентилятор' series={[{ name: 'fan.rpm', label: 'об/мин' }]} range={range} format={(v) => `${Math.round(v)}`} domain={[0, 'auto']} />
        {ifaces.map((i) => (
          <MetricChart
            key={i}
            title={`Сеть: ${i}`}
            series={[
              { name: `net.${i}.rx`, label: 'Входящий' },
              { name: `net.${i}.tx`, label: 'Исходящий' },
            ]}
            range={range}
            format={formatBps}
            domain={[0, 'auto']}
          />
        ))}
      </div>
    </div>
  )
}
