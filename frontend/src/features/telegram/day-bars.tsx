import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

// Столбики «по дням» (30 дней) — для тревог и заявок
export function DayBars({ data, label, color = 'var(--info)' }: { data: { day: string; count: number }[]; label: string; color?: string }) {
  return (
    <div className='h-36'>
      <ResponsiveContainer width='100%' height='100%'>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <XAxis dataKey='day' tickFormatter={(d: string) => d.slice(8, 10)} fontSize={10} interval={2} />
          <YAxis allowDecimals={false} fontSize={10} width={28} />
          <Tooltip
            labelFormatter={(d) => new Date(String(d)).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })}
            formatter={(v) => [String(v), label]}
            contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
          />
          <Bar dataKey='count' fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
