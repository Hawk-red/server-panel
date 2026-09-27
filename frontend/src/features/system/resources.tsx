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
  // Цвета серий подобраны парами по смыслу; синий и голубой рядом не ставятся
  const CORE_COLORS = ['var(--info)', 'var(--ok)', 'var(--brand)', 'var(--chart-4)']
  const cpuSeries: SeriesDef[] = perCore
    ? cores.map((n, i) => ({ name: n, label: `Ядро ${n.slice(8)}`, color: CORE_COLORS[i % CORE_COLORS.length] }))
    : [{ name: 'cpu.total', label: 'CPU', color: 'var(--info)' }]
  // Температура дисков: синий, зелёный, фиолетовый, серый (отдельный график от CPU)
  const DISK_COLORS = ['var(--info)', 'var(--ok)', 'var(--brand)', 'var(--chart-4)']
  const diskTemps: SeriesDef[] = (names ?? [])
    .filter((n) => n.startsWith('temp.disk.'))
    .map((n, i) => ({ name: n, label: n.slice('temp.disk.'.length), color: DISK_COLORS[i % DISK_COLORS.length] }))
  const ifaces = Object.keys(snap?.network ?? {})
  const lan = ifaces.find((i) => /^(enp|eth)/.test(i))

  return (
    <div className='space-y-3'>
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
      {/* Порядок по важности: CPU и load → температура и вентилятор → RAM/swap → сеть → диски → VPN.
          На 1440×900 и 1920×1080 все 8 графиков помещаются на один экран (сетка 4×2). */}
      <div className='grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
        <MetricChart title='Загрузка CPU' series={cpuSeries} range={range} format={pct} domain={[0, 100]} />
        <MetricChart title='Load average (1 мин)' series={[{ name: 'load.1', label: 'Load 1m', color: 'var(--info)' }]} range={range} format={(v) => v.toFixed(2)} domain={[0, 'auto']} />
        <MetricChart title='Температура CPU' series={[{ name: 'temp.cpu', label: 'CPU', color: 'var(--info)' }]} range={range} format={deg} />
        <MetricChart title='Вентилятор, об/мин' series={[{ name: 'fan.rpm', label: 'об/мин', color: 'var(--info)' }]} range={range} format={(v) => `${Math.round(v)}`} domain={[0, 'auto']} />
        <MetricChart
          title='Память и swap'
          series={[
            { name: 'mem.used_pct', label: 'RAM', color: 'var(--info)' },
            { name: 'swap.used_pct', label: 'Swap', color: 'var(--brand)' },
          ]}
          range={range}
          format={pct}
          domain={[0, 100]}
        />
        {lan && (
          <MetricChart
            title={`Сеть LAN (${lan})`}
            series={[
              { name: `net.${lan}.rx`, label: 'Приём', color: 'var(--info)' },
              { name: `net.${lan}.tx`, label: 'Отдача', color: 'var(--ok)' },
            ]}
            range={range}
            format={formatBps}
            domain={[0, 'auto']}
          />
        )}
        <MetricChart title='Температура дисков' series={diskTemps} range={range} format={deg} />
        {ifaces.includes('wg0') && (
          <MetricChart
            title='VPN (wg0)'
            series={[
              { name: 'net.wg0.rx', label: 'Приём', color: 'var(--info)' },
              { name: 'net.wg0.tx', label: 'Отдача', color: 'var(--ok)' },
            ]}
            range={range}
            format={formatBps}
            domain={[0, 'auto']}
          />
        )}
      </div>
    </div>
  )
}
