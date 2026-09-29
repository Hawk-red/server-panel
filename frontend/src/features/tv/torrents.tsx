import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDuration } from '@/lib/format'
import type { TorrentsData } from '@/lib/types'
import { Meter } from '@/components/meter'
import { Value } from '@/components/value'
import { Tile } from './shell'

export function TvTorrents() {
  const { data } = useQuery({ queryKey: ['torrents'], queryFn: async () => (await api.get<TorrentsData>('/torrents')).data, refetchInterval: 10_000 })
  const t = data?.summary.data
  const g = data?.guard.data
  const c = data?.container.data
  const usedPct = g?.downloadsTotal && g.downloadsFree != null ? (1 - g.downloadsFree / g.downloadsTotal) * 100 : null
  const active = (t?.active ?? []).slice(0, 6)

  return (
    <>
      <div className='grid grid-cols-4 gap-4'>
        <Tile title='Скорость'>
          {t ? (
            <>
              <div className='text-4xl font-bold'>
                <Value kind='speed' value={t.speed.dl} flow='rx' prefix='↓ ' />
              </div>
              <div className='mt-1 text-3xl'>
                <Value kind='speed' value={t.speed.ul} flow='tx' prefix='↑ ' />
              </div>
            </>
          ) : (
            <span className='text-lg text-muted-foreground'>{data?.summary.error ?? 'нет данных'}</span>
          )}
        </Tile>
        <Tile title='Торренты'>
          <div className='text-6xl font-bold'>{t?.counts.total ?? '—'}</div>
          <div className='mt-3 text-base text-muted-foreground'>
            качается {t?.counts.downloading ?? '—'} · раздаётся {t?.counts.seeding ?? '—'}
            {t && t.counts.errored > 0 && <span className='text-danger-foreground'> · с ошибкой {t.counts.errored}</span>}
          </div>
        </Tile>
        <Tile title='Свободно для закачек'>
          <div className='text-5xl font-bold'>
            <Value kind='bytes' value={g?.downloadsFree} />
          </div>
          <Meter value={usedPct} className='mt-3 h-3' label='Диск закачек' />
          <div className='mt-2 text-base text-muted-foreground'>
            {g?.lastPause ? <span className='text-warn-foreground'>закачки приостанавливались защитой диска</span> : g?.thresholdGb ? `защита ставит на паузу при < ${g.thresholdGb} ГБ` : ''}
          </div>
        </Tile>
        <Tile title='qBittorrent'>
          <div className={`text-4xl font-bold ${c?.state === 'running' ? 'text-ok-foreground' : 'text-danger-foreground'}`}>{c ? (c.state === 'running' ? 'Работает' : c.state) : '—'}</div>
          <div className='mt-3 text-base text-muted-foreground'>{t ? `v${t.version} · ${t.connection}` : ''}</div>
        </Tile>
      </div>

      <Tile title={`Активные (${t?.active.length ?? 0})`} className='mt-4'>
        {active.length === 0 ? (
          <span className='text-2xl text-muted-foreground'>Сейчас ничего не качается и не раздаётся</span>
        ) : (
          <ul className='space-y-4'>
            {active.map((a) => (
              <li key={a.hash}>
                <div className='flex items-baseline justify-between gap-4 text-xl'>
                  <span className='min-w-0 truncate'>{a.name}</span>
                  <span className='flex shrink-0 items-baseline gap-5'>
                    {a.dlspeed > 0 && <Value kind='speed' value={a.dlspeed} flow='rx' prefix='↓ ' />}
                    {a.upspeed > 0 && <Value kind='speed' value={a.upspeed} flow='tx' prefix='↑ ' />}
                    <span className='w-20 text-end tabular-nums'>{Math.round(a.progress * 100)}%</span>
                    <span className='w-28 text-end text-muted-foreground tabular-nums'>{a.eta ? formatDuration(a.eta) : ''}</span>
                  </span>
                </div>
                <Meter value={a.progress * 100} direction='neutral' className='mt-1 h-3' label={a.name} />
              </li>
            ))}
          </ul>
        )}
        {t && t.active.length > active.length && <div className='mt-3 text-base text-muted-foreground'>и ещё {t.active.length - active.length}</div>}
      </Tile>
    </>
  )
}
