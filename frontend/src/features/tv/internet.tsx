import { useQuery } from '@tanstack/react-query'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDuration, formatRelative } from '@/lib/format'
import type { InternetStatus, SpeedtestState } from '@/features/infra-types'
import { Value } from '@/components/value'
import { Tile, TvChart } from './shell'

const ms = (v: number | null | undefined) => (v == null ? '—' : `${v < 10 ? v.toFixed(1) : Math.round(v)} мс`)

export function TvInternet() {
  const net = useQuery({ queryKey: ['internet'], queryFn: async () => (await api.get<InternetStatus>('/internet')).data, refetchInterval: 10_000 })
  const speed = useQuery({ queryKey: ['speedtest'], queryFn: async () => (await api.get<SpeedtestState>('/internet/speedtest')).data, refetchInterval: 60_000 })
  const d = net.data
  const online = d?.now?.online
  const last = speed.data?.results.find((r) => !r.error)
  const outages = d?.outages.slice(0, 3) ?? []

  return (
    <>
      <div className='grid grid-cols-4 gap-4'>
        <Tile title='Связь'>
          <div className={`flex items-center gap-3 text-5xl font-bold ${online === false ? 'text-danger-foreground' : 'text-ok-foreground'}`}>
            {online === false ? <CircleAlert className='size-11' aria-hidden /> : <CircleCheck className='size-11' aria-hidden />}
            {online === undefined ? '—' : online ? 'Есть' : 'Нет'}
          </div>
          <div className='mt-3 text-base text-muted-foreground'>
            пинг {d?.targets.main ?? '1.1.1.1'}: <span className='text-foreground'>{ms(d?.now?.main)}</span>
            {d?.downSince ? <span className='text-danger-foreground'> · нет связи {formatDuration(Math.round((Date.now() - d.downSince) / 1000))}</span> : null}
          </div>
        </Tile>
        <Tile title='Потери за 24 ч'>
          <div className={`text-6xl font-bold ${(d?.day.lossPct ?? 0) >= 5 ? 'text-danger-foreground' : (d?.day.lossPct ?? 0) >= 1 ? 'text-warn-foreground' : 'text-ok-foreground'}`}>{d?.day.lossPct != null ? `${d.day.lossPct}%` : '—'}</div>
          <div className='mt-3 text-base text-muted-foreground'>
            средний пинг {ms(d?.day.avgMs)} · максимум {ms(d?.day.maxMs)}
          </div>
        </Tile>
        <Tile title='Скорость (последний замер)'>
          {last ? (
            <>
              <div className='text-4xl font-bold'>
                <Value kind='number' value={last.downMbps} digits={0} prefix='↓ ' suffix=' Мбит/с' className='text-rx' />
              </div>
              <div className='text-3xl'>
                <Value kind='number' value={last.upMbps} digits={0} prefix='↑ ' suffix=' Мбит/с' className='text-tx' />
              </div>
              <div className='mt-2 text-base text-muted-foreground'>
                пинг {ms(last.latencyMs)} · {formatRelative(last.ts)}
              </div>
            </>
          ) : (
            <span className='text-lg text-muted-foreground'>замеров ещё нет</span>
          )}
        </Tile>
        <Tile title='Внешний IP'>
          <div className='font-mono text-3xl font-bold text-address'>{d?.ip?.ip ?? '—'}</div>
          <div className='mt-3 text-base text-muted-foreground'>{d?.ip ? `не менялся с ${new Date(d.ip.since).toLocaleDateString('ru-RU')}` : ''}</div>
        </Tile>
      </div>

      <div className='mt-4 grid grid-cols-2 gap-4'>
        <TvChart title={`Пинг до ${d?.targets.main ?? '1.1.1.1'}, сутки`} series={[{ name: 'inet.ping_ms', color: 'var(--info)' }]} range='day' format={(v) => `${Math.round(v)}`} domain={[0, 'auto']} heightRem={11} />
        <TvChart
          title='Скорость по замерам, неделя (Мбит/с)'
          series={[
            { name: 'inet.speed_down', color: 'var(--rx)' },
            { name: 'inet.speed_up', color: 'var(--tx)' },
          ]}
          range='week'
          format={(v) => `${Math.round(v)}`}
          domain={[0, 'auto']}
          heightRem={11}
        />
      </div>

      <Tile title='Обрывы связи' className='mt-4'>
        {outages.length === 0 ? (
          <span className='inline-flex items-center gap-2 text-xl text-ok-foreground'>
            <CircleCheck className='size-6' /> Обрывов дольше минуты не было
          </span>
        ) : (
          <ul className='space-y-1 text-xl'>
            {outages.map((o) => (
              <li key={o.from}>
                {new Date(o.from).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} — {formatDuration(o.sec)}
              </li>
            ))}
          </ul>
        )}
      </Tile>
    </>
  )
}
