import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

// Столбики по периоду (день или неделя) — для тревог и заявок. Подписи: день — число, неделя — «дд.мм» начала отрезка.
export function DayBars({ data, label, color = 'var(--info)', bucket = 'day' }: { data: { day: string; count: number }[]; label: string; color?: string; bucket?: 'day' | 'week' }) {
  const tick = (d: string) => (bucket === 'week' ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : d.slice(8, 10))
  return (
    <div className='h-36'>
      <ResponsiveContainer width='100%' height='100%'>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <XAxis dataKey='day' tickFormatter={tick} fontSize={10} interval={Math.max(0, Math.ceil(data.length / 12) - 1)} />
          <YAxis allowDecimals={false} fontSize={10} width={28} />
          <Tooltip
            labelFormatter={(d) => (bucket === 'week' ? `неделя с ${new Date(String(d)).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })}` : new Date(String(d)).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' }))}
            formatter={(v) => [String(v), label]}
            contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
          />
          <Bar dataKey='count' fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
