import { useQuery } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import type { Overview, TorrentsData } from '@/lib/types'
import { Meter } from '@/components/meter'
import { Value } from '@/components/value'
import { Tile } from './shell'

export function TvOverview() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: async () => (await api.get<Overview>('/overview')).data, refetchInterval: 10_000 })
  const torrents = useQuery({ queryKey: ['torrents'], queryFn: async () => (await api.get<TorrentsData>('/torrents')).data, refetchInterval: 10_000 })
  const o = overview.data
  const s = o?.snapshot
  const mem = s?.memory
  const t = torrents.data?.summary.data
  const errors = o?.problems.filter((p) => p.level === 'error').length ?? 0

  return (
    <>
      <div className='grid grid-cols-4 gap-4'>
        <Tile title='CPU'>
          <Value kind='percent' value={s?.cpu?.total} direction='higher-worse' className='text-5xl font-bold' />
          <Meter value={s?.cpu?.total} className='mt-3 h-3' label='CPU' />
        </Tile>
        <Tile title='Температура'>
          <Value kind='temp-cpu' value={s?.temperature?.cpu} className='text-5xl font-bold' />
          <div className='mt-2 text-base text-muted-foreground'>вентилятор {s?.fan?.rpm ?? '—'} об/мин</div>
        </Tile>
        <Tile title='Память'>
          <Value kind='percent' value={mem ? (mem.used / mem.total) * 100 : null} direction='higher-worse' className='text-5xl font-bold' />
          <Meter value={mem ? (mem.used / mem.total) * 100 : null} className='mt-3 h-3' label='Память' />
          <div className='mt-1 text-base text-muted-foreground'>
            <Value kind='bytes' value={mem?.used} /> из <Value kind='bytes' value={mem?.total} />
          </div>
        </Tile>
        <Tile title='Службы'>
          <div className='flex items-center gap-3 text-5xl font-bold'>
            {o?.services && o.services.failed > 0 ? (
              <CircleAlert className='size-10 text-danger-foreground' aria-label='есть упавшие' />
            ) : (
              <CircleCheck className='size-10 text-ok-foreground' aria-label='всё работает' />
            )}
            <Value kind='count' value={o?.services?.running} />
          </div>
          <div className='mt-2 text-base text-muted-foreground'>
            работают · {o?.services?.failed ? <span className='text-danger-foreground'>упало {o.services.failed}</span> : 'упавших нет'}
          </div>
        </Tile>
      </div>

      <div className='mt-4 grid grid-cols-3 gap-4'>
        <Tile title='Диски'>
          <div className='space-y-3'>
            {(s?.disks ?? [])
              .filter((d) => d.mount && d.mount !== '/boot/efi')
              .map((d) => (
                <div key={d.device}>
                  <div className='flex justify-between text-lg'>
                    <span>{d.mount}</span>
                    <Value kind='percent' value={d.percent} direction='higher-worse' className='font-semibold' />
                  </div>
                  <Meter value={d.percent} className='h-3' label={d.mount ?? ''} />
                </div>
              ))}
          </div>
        </Tile>
        <Tile title={`Проблемы${o ? ` (${o.problems.length})` : ''}`}>
          {o && o.problems.length === 0 ? (
            <div className='flex items-center gap-2 text-2xl text-ok-foreground'>
              <CircleCheck className='size-7' /> Всё в порядке
            </div>
          ) : (
            <ul className='space-y-2 text-lg'>
              {o?.problems.slice(0, 6).map((p, i) => (
                <li key={i} className='flex items-start gap-2'>
                  {p.level === 'error' ? (
                    <CircleAlert className='mt-1 size-5 shrink-0 text-danger-foreground' aria-label='ошибка' />
                  ) : (
                    <TriangleAlert className='mt-1 size-5 shrink-0 text-warn-foreground' aria-label='предупреждение' />
                  )}
                  {p.text}
                </li>
              ))}
              {o && o.problems.length > 6 && <li className='text-base text-muted-foreground'>и ещё {o.problems.length - 6}</li>}
            </ul>
          )}
          {errors > 0 && <div className='mt-3 text-base text-danger-foreground'>Ошибок: {errors}</div>}
        </Tile>
        <Tile title='Торренты'>
          {t ? (
            <div className='space-y-2 text-lg'>
              <div className='text-4xl font-bold'>
                <Value kind='speed' value={t.speed.dl} flow='rx' prefix='↓ ' />
              </div>
              <div className='text-2xl'>
                <Value kind='speed' value={t.speed.ul} flow='tx' prefix='↑ ' />
              </div>
              <div className='text-base text-muted-foreground'>
                качается {t.counts.downloading} · раздаётся {t.counts.seeding} · всего {t.counts.total}
              </div>
            </div>
          ) : (
            <span className='text-lg text-muted-foreground'>нет данных</span>
          )}
        </Tile>
      </div>
      <footer className='mt-4 text-sm text-muted-foreground'>Аптайм {s?.uptimeSec ? <Value kind='duration' value={s.uptimeSec} /> : '—'}</footer>
    </>
  )
}
