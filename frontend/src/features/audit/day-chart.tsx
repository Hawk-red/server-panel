import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AuditSummary } from '@/lib/types'

// График по дням (30 дней): действия панели и системные события
export function DayChart({ perDay }: { perDay: AuditSummary['perDay'] }) {
  const days: { day: string; user: number; system: number }[] = []
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toLocaleDateString('sv-SE')
    days.push({
      day,
      user: perDay.find((p) => p.day === day && p.type === 'user')?.n ?? 0,
      system: perDay.find((p) => p.day === day && p.type === 'system')?.n ?? 0,
    })
  }
  return (
    <div className='h-40'>
      <ResponsiveContainer width='100%' height='100%'>
        <BarChart data={days} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <XAxis dataKey='day' tickFormatter={(d: string) => d.slice(8, 10)} fontSize={10} interval={2} />
          <YAxis allowDecimals={false} fontSize={10} width={28} />
          <Tooltip
            labelFormatter={(d) => new Date(String(d)).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })}
            formatter={(v, name) => [String(v), name === 'user' ? 'Действия панели' : 'Системные события']}
            contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
          />
          <Legend formatter={(n) => (n === 'user' ? 'Действия панели' : 'Системные события')} wrapperStyle={{ fontSize: 11 }} iconSize={8} />
          <Bar dataKey='user' stackId='a' fill='var(--info)' isAnimationActive={false} />
          <Bar dataKey='system' stackId='a' fill='var(--ok)' radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
