import { useQuery } from '@tanstack/react-query'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { api } from '@/lib/api'
import type { Overview } from '@/lib/types'
import { Meter } from '@/components/meter'
import { Value } from '@/components/value'
import { Tile, TvChart } from './shell'

export function TvSystem() {
  const { data: o } = useQuery({ queryKey: ['overview'], queryFn: async () => (await api.get<Overview>('/overview')).data, refetchInterval: 10_000 })
  const s = o?.snapshot
  const mem = s?.memory
  const memPct = mem ? (mem.used / mem.total) * 100 : null
  const swapPct = mem && mem.swapTotal > 0 ? (mem.swapUsed / mem.swapTotal) * 100 : null

  return (
    <>
      <div className='grid grid-cols-4 gap-4'>
        <Tile title='Загрузка CPU'>
          <Value kind='percent' value={s?.cpu?.total} direction='higher-worse' className='text-6xl font-bold' />
          <Meter value={s?.cpu?.total} className='mt-3 h-3' label='CPU' />
          <div className='mt-2 text-base text-muted-foreground'>load {s?.load ? `${s.load.l1.toFixed(2)} · ${s.load.l5.toFixed(2)} · ${s.load.l15.toFixed(2)}` : '—'}</div>
        </Tile>
        <Tile title='Температура CPU'>
          <Value kind='temp-cpu' value={s?.temperature?.cpu} className='text-6xl font-bold' />
          <div className='mt-3 text-base text-muted-foreground'>вентилятор {s?.fan?.rpm ?? '—'} об/мин</div>
        </Tile>
        <Tile title='Память'>
          <Value kind='percent' value={memPct} direction='higher-worse' className='text-6xl font-bold' />
          <Meter value={memPct} className='mt-3 h-3' label='Память' />
          <div className='mt-2 text-base text-muted-foreground'>
            <Value kind='bytes' value={mem?.used} /> из <Value kind='bytes' value={mem?.total} />
            {swapPct !== null && <> · swap {Math.round(swapPct)}%</>}
          </div>
        </Tile>
        <Tile title='Службы'>
          <div className='flex items-center gap-3 text-6xl font-bold'>
            {o?.services && o.services.failed > 0 ? <CircleAlert className='size-12 text-danger-foreground' aria-label='есть упавшие' /> : <CircleCheck className='size-12 text-ok-foreground' aria-label='всё работает' />}
            <Value kind='count' value={o?.services?.running} />
          </div>
          <div className='mt-3 text-base text-muted-foreground'>
            из {o?.services?.total ?? '—'} · {o?.services?.failed ? <span className='text-danger-foreground'>упало {o.services.failed}</span> : 'упавших нет'}
          </div>
        </Tile>
      </div>

      <div className='mt-4 grid grid-cols-5 gap-4'>
        <Tile title='Диски' className='col-span-2'>
          <div className='space-y-4'>
            {(s?.disks ?? [])
              .filter((d) => d.mount && d.mount !== '/boot/efi')
              .map((d) => (
                <div key={d.device}>
                  <div className='flex items-baseline justify-between gap-3 text-xl'>
                    <span className='font-mono'>{d.mount}</span>
                    <span className='flex items-baseline gap-4'>
                      {d.smart?.temperature != null && <Value kind='temp-disk' value={d.smart.temperature} className='text-base' />}
                      <Value kind='percent' value={d.percent} direction='higher-worse' className='font-semibold' />
                    </span>
                  </div>
                  <Meter value={d.percent} className='mt-1 h-3' label={d.mount ?? ''} />
                </div>
              ))}
          </div>
        </Tile>
        <div className='col-span-3 grid gap-4'>
          <TvChart title='Загрузка CPU, сутки' series={[{ name: 'cpu.total', color: 'var(--info)' }]} range='day' format={(v) => `${Math.round(v)}%`} domain={[0, 100]} heightRem={6.5} />
          <TvChart title='Температура CPU, сутки' series={[{ name: 'temp.cpu', color: 'var(--danger)' }]} range='day' format={(v) => `${Math.round(v)}°`} heightRem={6.5} />
        </div>
      </div>
      <footer className='mt-4 text-sm text-muted-foreground'>Аптайм {s?.uptimeSec ? <Value kind='duration' value={s.uptimeSec} /> : '—'}</footer>
    </>
  )
}
