import { CircleAlert, CircleCheck } from 'lucide-react'
import type { Range } from '@/lib/types'
import type { InternetStatus } from '@/features/infra-types'
import { MetricChart } from '@/components/metric-chart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const ms = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} мс`

type Key = 'router' | 'main' | 'second' | 'prod' | 'adguard'

// Метрика — имя серии в /api/metrics; цвет для графика «внешние узлы» (роутер вынесен отдельно: ~0.5 мс сплющило бы шкалу)
const ROWS: { key: Key; label: string; metric: string; color: string }[] = [
  { key: 'router', label: 'Роутер', metric: 'inet.router_ms', color: 'var(--chart-2)' },
  { key: 'main', label: '1.1.1.1', metric: 'inet.ping_ms', color: 'var(--info)' },
  { key: 'second', label: '8.8.8.8', metric: 'inet.second_ms', color: 'var(--chart-3)' },
  { key: 'prod', label: 'Прод-сервер', metric: 'inet.prod_ms', color: 'var(--chart-5)' },
  { key: 'adguard', label: 'DNS AdGuard', metric: 'inet.adguard_ms', color: 'var(--chart-6)' },
]

export function TargetsCard({ data, range }: { data: InternetStatus | undefined; range: Range }) {
  const now = data?.now
  const cur = (k: Key): number | null | undefined => (!now ? undefined : k === 'router' || k === 'prod' || k === 'adguard' ? now.extra?.[k] : now[k])
  const addr = (k: Key) => (data ? data.targets[k] : '')

  // Роутер не отвечает, а внешние узлы да — маловероятно; роутер молчит вместе с ними — виноват «наш конец»
  const routerDown = now?.extra && now.extra.router === null
  const hint = !now?.extra
    ? null
    : routerDown && !now.online
      ? 'Роутер не отвечает — проблема в локальной сети или самом роутере, а не у провайдера.'
      : !now.online
        ? 'Роутер отвечает, а внешние узлы — нет: проблема на стороне провайдера.'
        : routerDown
          ? 'Роутер не отвечает на ping (возможно, он его игнорирует), но интернет работает.'
          : null

  return (
    <>
      <Card className='gap-2'>
        <CardHeader>
          <CardTitle className='text-sm font-medium'>Задержка до узлов</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='overflow-x-auto'>
            <table className='w-full min-w-[420px] text-sm'>
              <thead className='text-left text-xs text-muted-foreground'>
                <tr>
                  <th className='py-1 pr-3 font-normal'>Узел</th>
                  <th className='py-1 pr-3 font-normal'>Сейчас</th>
                  <th className='py-1 pr-3 font-normal'>Среднее, 24 ч</th>
                  <th className='py-1 font-normal'>Максимум, 24 ч</th>
                </tr>
              </thead>
              <tbody className='divide-y'>
                {ROWS.map((r) => {
                  const v = cur(r.key)
                  const d = data?.targetDay?.[r.key]
                  return (
                    <tr key={r.key}>
                      <td className='py-2 pr-3'>
                        <span className='inline-flex items-center gap-2'>
                          <span className='size-2 rounded-full' style={{ background: r.color }} />
                          {r.label}
                          <span className='text-xs text-muted-foreground'>{addr(r.key)}</span>
                        </span>
                      </td>
                      <td className='py-2 pr-3'>
                        {v === undefined ? (
                          '—'
                        ) : v === null ? (
                          <span className='inline-flex items-center gap-1 text-danger-foreground'>
                            <CircleAlert className='size-4' /> нет ответа
                          </span>
                        ) : (
                          <span className='inline-flex items-center gap-1'>
                            <CircleCheck className='size-4 text-ok-foreground' /> {ms(v)}
                          </span>
                        )}
                      </td>
                      <td className='py-2 pr-3'>{d?.avgMs != null ? ms(d.avgMs) : '—'}</td>
                      <td className='py-2'>{d?.maxMs != null ? ms(d.maxMs) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {hint && <p className='mt-3 text-sm text-warn-foreground'>{hint}</p>}
          <p className='mt-3 text-xs text-muted-foreground'>
            Роутер, 1.1.1.1, 8.8.8.8 и прод — ICMP-ping раз в 30 с; «DNS AdGuard» — время ответа на DNS-запрос (обычно из кэша). Эти узлы только для диагностики: «нет связи» по-прежнему
            определяется по 1.1.1.1 и 8.8.8.8.
          </p>
        </CardContent>
      </Card>
      <div className='mt-3 grid gap-3 lg:grid-cols-2'>
        <MetricChart title='Задержка до внешних узлов, мс' series={ROWS.filter((r) => r.key !== 'router' && r.key !== 'adguard').map((r) => ({ name: r.metric, label: r.label, color: r.color }))} range={range} format={ms} domain={[0, 'auto']} />
        <MetricChart
          title='Роутер и DNS AdGuard, мс'
          series={ROWS.filter((r) => r.key === 'router' || r.key === 'adguard').map((r) => ({ name: r.metric, label: r.label, color: r.color }))}
          range={range}
          format={ms}
          domain={[0, 'auto']}
        />
      </div>
    </>
  )
}
