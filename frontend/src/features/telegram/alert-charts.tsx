import { useId } from 'react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AlertStats } from '@/lib/types'

// Красный — ракеты (штриховка, чтобы отличалось и без цвета), синий — дроны и прочее (сплошной)
const RED = 'var(--destructive)'
const BLUE = 'var(--info)'

const fmtDay = (d: string, bucket: 'day' | 'week') => {
  const s = new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })
  return bucket === 'week' ? `неделя с ${s}` : s
}

function StatsTooltip({ active, payload, bucket }: { active?: boolean; payload?: { payload: AlertStats['series'][number] }[]; bucket: 'day' | 'week' }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className='rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-md'>
      <div className='mb-1 font-medium'>{fmtDay(p.day, bucket)}</div>
      <div>Всего сообщений: {p.all}</div>
      <div>Ракеты: {p.missile}</div>
      <div>Дроны: {p.drone}</div>
      <div>Авиация: {p.aviation}</div>
      <div>Прочее: {p.other}</div>
    </div>
  )
}

/** mode='stack' — стопка (дроны и прочее + ракеты); mode='missile' — только ракеты */
export function StatsBars({ series, bucket, mode }: { series: AlertStats['series']; bucket: 'day' | 'week'; mode: 'stack' | 'missile' }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const tick = (d: string) => (bucket === 'week' ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : d.slice(8, 10))
  return (
    <div className='h-36 sm:h-44'>
      <ResponsiveContainer width='100%' height='100%'>
        <BarChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <pattern id={`hatch${id}`} width='6' height='6' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'>
              <rect width='6' height='6' fill={RED} />
              <rect width='2' height='6' fill='var(--background)' opacity='0.55' />
            </pattern>
          </defs>
          <XAxis dataKey='day' tickFormatter={tick} fontSize={10} interval={Math.max(0, Math.ceil(series.length / 12) - 1)} />
          <YAxis allowDecimals={false} fontSize={10} width={28} />
          <Tooltip content={<StatsTooltip bucket={bucket} />} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
          {mode === 'stack' && <Bar dataKey='rest' stackId='a' fill={BLUE} isAnimationActive={false} />}
          <Bar dataKey='missile' stackId='a' fill={`url(#hatch${id})`} stroke={RED} strokeWidth={1} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
