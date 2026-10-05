import type { ReactNode } from 'react'
import { Cpu, MemoryStick, Thermometer } from 'lucide-react'
import type { Snapshot } from '@/lib/types'
import { Meter } from '@/components/meter'
import { NoData } from '@/components/no-data'
import { Value } from '@/components/value'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Один индикатор: подпись с иконкой, крупное значение, полоска по порогам и строка-пояснение
function Indicator({ title, icon: Icon, value, meter, sub, noDataReason, loading }: { title: string; icon: React.ElementType; value: ReactNode; meter?: ReactNode; sub?: ReactNode; noDataReason?: string | null; loading: boolean }) {
  return (
    <div className='min-w-0 space-y-1.5'>
      <div className='flex items-center gap-1.5 text-xs font-medium text-muted-foreground'>
        <Icon className='size-3.5 shrink-0' aria-hidden='true' />
        {title}
      </div>
      <div className='text-2xl font-bold tabular-nums'>{value ?? (loading ? <span className='text-base font-normal text-muted-foreground'>загрузка…</span> : <NoData reason={noDataReason} />)}</div>
      {meter}
      {sub && <div className='text-xs text-muted-foreground'>{sub}</div>}
    </div>
  )
}

// Ресурсы сервера: процессор, температура и память в одном блоке — три индикатора с одной шкалой порогов
export function ResourcesCard({ snapshot: s, err }: { snapshot: Snapshot | null | undefined; err: (name: string) => string | null }) {
  const loading = !s
  const mem = s?.memory
  const memPct = mem ? (mem.used / mem.total) * 100 : null
  return (
    <Card className='gap-3'>
      <CardHeader>
        <CardTitle className='text-sm font-medium'>Ресурсы сервера</CardTitle>
      </CardHeader>
      <CardContent className='grid gap-5 sm:grid-cols-3 sm:gap-4'>
        <Indicator
          title='Процессор'
          icon={Cpu}
          loading={loading}
          noDataReason={err('cpu')}
          value={s?.cpu ? <Value kind='percent' value={s.cpu.total} direction='higher-worse' /> : null}
          meter={s?.cpu ? <Meter value={s.cpu.total} direction='higher-worse' label='Процессор' /> : null}
          sub={s?.load ? `нагрузка ${s.load.l1.toFixed(2)} / ${s.load.l5.toFixed(2)} / ${s.load.l15.toFixed(2)}` : undefined}
        />
        <Indicator
          title='Температура'
          icon={Thermometer}
          loading={loading}
          noDataReason={err('temperature')}
          value={s?.temperature ? <Value kind='temp-cpu' value={s.temperature.cpu} /> : null}
          meter={s?.temperature ? <Meter value={s.temperature.cpu} temp='cpu' label='Температура процессора' /> : null}
          sub={s?.fan ? <>вентилятор <Value kind='count' value={s.fan.rpm} /> об/мин</> : 'вентилятор: нет данных'}
        />
        <Indicator
          title='Память'
          icon={MemoryStick}
          loading={loading}
          noDataReason={err('memory')}
          value={memPct != null ? <Value kind='percent' value={memPct} direction='higher-worse' /> : null}
          meter={memPct != null ? <Meter value={memPct} direction='higher-worse' label='Память' /> : null}
          sub={mem ? <>занято <Value kind='bytes' value={mem.used} /> из <Value kind='bytes' value={mem.total} /> · swap <Value kind='bytes' value={mem.swapUsed} /></> : undefined}
        />
      </CardContent>
    </Card>
  )
}
