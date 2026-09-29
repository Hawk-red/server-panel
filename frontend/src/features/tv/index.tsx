import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CircleAlert, CircleCheck, Server, TriangleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import type { Overview, TorrentsData } from '@/lib/types'
import { Meter } from '@/components/meter'
import { Value } from '@/components/value'

// Режим «ТВ» (/tv): полноэкранная сводка для просмотра с дивана — без меню, крупно, с автообновлением.
// Масштаб: базовый шрифт привязан к ширине экрана (1920 px ≈ 22 px, 3840 px ≈ 44 px), всё в rem.
function useTvScale() {
  useEffect(() => {
    const root = document.documentElement
    const prev = root.style.fontSize
    root.style.fontSize = 'clamp(16px, 1.15vw, 48px)'
    return () => {
      root.style.fontSize = prev
    }
  }, [])
}

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(t)
  }, [])
  return (
    <span className='text-time tabular-nums'>
      {now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · {now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
    </span>
  )
}

function Tile({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className='rounded-2xl border bg-card p-5'>
      <div className='mb-2 text-base text-muted-foreground'>{title}</div>
      {children}
    </div>
  )
}

export function TvMode() {
  useTvScale()
  const overview = useQuery({ queryKey: ['overview'], queryFn: async () => (await api.get<Overview>('/overview')).data, refetchInterval: 10_000 })
  const torrents = useQuery({ queryKey: ['torrents'], queryFn: async () => (await api.get<TorrentsData>('/torrents')).data, refetchInterval: 10_000 })
  const o = overview.data
  const s = o?.snapshot
  const mem = s?.memory
  const t = torrents.data?.summary.data
  const errors = o?.problems.filter((p) => p.level === 'error').length ?? 0

  return (
    <div className='min-h-svh bg-background p-6 text-foreground'>
      <header className='mb-5 flex items-center justify-between gap-4'>
        <div className='flex items-center gap-3 text-3xl font-bold'>
          <Server className='size-9 text-brand' /> Mac Mini
        </div>
        <div className='text-xl'>
          <Clock />
        </div>
        <Link to='/' className='rounded-lg border px-4 py-2 text-base text-muted-foreground'>
          Панель ←
        </Link>
      </header>

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
      <footer className='mt-4 text-sm text-muted-foreground'>Обновляется каждые 10 секунд · аптайм {s?.uptimeSec ? <Value kind='duration' value={s.uptimeSec} /> : '—'}</footer>
    </div>
  )
}
