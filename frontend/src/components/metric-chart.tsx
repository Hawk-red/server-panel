import { useQuery } from '@tanstack/react-query'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '@/lib/api'
import type { MetricsResponse, Range } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NoData } from './no-data'

export const RANGE_LABELS: Record<Range, string> = {
  hour: 'Час',
  day: 'Сутки',
  week: 'Неделя',
  month: 'Месяц',
  quarter: '3 месяца',
}

// Единая палитра серий (theme.css): фиолетовый, голубой, зелёный, синий, индиго, серый
const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)']

export type SeriesDef = { name: string; label: string }

type MetricChartProps = {
  title: string
  series: SeriesDef[]
  range: Range
  format: (v: number) => string
  domain?: [number | 'auto', number | 'auto']
}

function tickTime(ts: number, range: Range) {
  const d = new Date(ts)
  if (range === 'hour' || range === 'day') return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

export function MetricChart({ title, series, range, format, domain }: MetricChartProps) {
  const { data, isError } = useQuery({
    queryKey: ['metrics', range, series.map((s) => s.name).join(',')],
    queryFn: async () =>
      (await api.get<MetricsResponse>('/metrics', { params: { range, series: series.map((s) => s.name).join(',') } })).data,
    refetchInterval: range === 'hour' ? 30_000 : 5 * 60_000,
  })

  // Склеиваем серии в строки по времени для recharts
  const rows = new Map<number, Record<string, number>>()
  for (const s of series) {
    for (const [t, v] of data?.series[s.name] ?? []) {
      const row = rows.get(t) ?? { t }
      row[s.name] = v
      rows.set(t, row)
    }
  }
  const points = [...rows.values()].sort((a, b) => a.t - b.t)

  return (
    <Card className='gap-2'>
      <CardHeader>
        <CardTitle className='text-sm font-medium'>{title}</CardTitle>
      </CardHeader>
      <CardContent className='h-56 px-2'>
        {isError || (data && points.length === 0) ? (
          <div className='flex h-full items-center justify-center'>
            <NoData reason={isError ? 'ошибка запроса' : 'источник пока не собрал данных за этот период'} />
          </div>
        ) : (
          <ResponsiveContainer width='100%' height='100%'>
            <LineChart data={points} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray='3 3' className='stroke-muted' />
              <XAxis
                dataKey='t'
                type='number'
                domain={['dataMin', 'dataMax']}
                tickFormatter={(t) => tickTime(t, range)}
                fontSize={11}
                minTickGap={40}
              />
              <YAxis tickFormatter={format} fontSize={11} width={64} domain={domain ?? ['auto', 'auto']} />
              <Tooltip
                labelFormatter={(t) => new Date(Number(t)).toLocaleString('ru-RU')}
                formatter={(v, name) => [format(Number(v)), series.find((s) => s.name === name)?.label ?? String(name)]}
                contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
              />
              {series.length > 1 && (
                <Legend formatter={(name) => series.find((s) => s.name === name)?.label ?? name} wrapperStyle={{ fontSize: 12 }} />
              )}
              {series.map((s, i) => (
                <Line
                  key={s.name}
                  dataKey={s.name}
                  stroke={COLORS[i % COLORS.length]}
                  dot={false}
                  strokeWidth={1.75}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
