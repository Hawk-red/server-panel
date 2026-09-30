import { useQuery } from '@tanstack/react-query'
import { CircleCheck, TriangleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { formatRelative } from '@/lib/format'
import type { Device, DeviceType, NetworkData } from '@/lib/types'
import { Tile } from './shell'

const TYPE: Record<DeviceType, string> = {
  router: 'роутер', phone: 'телефон / планшет', tv: 'ТВ', media: 'медиа', iot: 'умный дом', unknown: 'другое',
}
const label = (d: Device) => d.name ?? d.hostname ?? d.vendor ?? d.ip

function Row({ d }: { d: Device }) {
  return (
    <li className='flex items-baseline justify-between gap-4'>
      <span className='min-w-0 truncate'>{label(d)}</span>
      <span className='flex shrink-0 items-baseline gap-4 text-base text-muted-foreground'>
        <span>{TYPE[d.type]}</span>
        <span className='w-40 text-end font-mono text-address'>{d.ip}</span>
      </span>
    </li>
  )
}

export function TvNetwork() {
  const { data } = useQuery({ queryKey: ['network'], queryFn: async () => (await api.get<NetworkData>('/network')).data, refetchInterval: 15_000 })
  const devices = data?.devices ?? []
  const unknown = devices.filter((d) => !d.known && d.online)
  const online = devices.filter((d) => d.online && d.known)
  const MAX = 10

  return (
    <>
      <div className='grid grid-cols-3 gap-4'>
        <Tile title='В сети сейчас'>
          <div className='text-6xl font-bold'>
            {data?.summary.online ?? '—'} <span className='text-3xl font-normal text-muted-foreground'>из {data?.summary.total ?? '—'}</span>
          </div>
        </Tile>
        <Tile title='Неизвестные устройства'>
          <div className={`flex items-center gap-3 text-6xl font-bold ${data && data.summary.unknown > 0 ? 'text-warn-foreground' : 'text-ok-foreground'}`}>
            {data && data.summary.unknown > 0 ? <TriangleAlert className='size-12' aria-label='есть неизвестные' /> : <CircleCheck className='size-12' aria-label='нет неизвестных' />}
            {data?.summary.unknown ?? '—'}
          </div>
        </Tile>
        <Tile title='Последнее сканирование'>
          <div className='text-4xl font-bold'>{formatRelative(data?.status.lastDiscovery)}</div>
          <div className={`mt-3 text-base ${data?.status.lastDiscoveryError ? 'text-danger-foreground' : 'text-muted-foreground'}`}>{data?.status.lastDiscoveryError ?? 'раз в 5 минут'}</div>
        </Tile>
      </div>

      {unknown.length > 0 && (
        <Tile title='Неизвестные, в сети' className='mt-4 border-warn'>
          <ul className='space-y-2 text-2xl'>
            {unknown.slice(0, 3).map((d) => (
              <Row key={d.mac} d={d} />
            ))}
          </ul>
        </Tile>
      )}

      <Tile title={`Известные, в сети (${online.length})`} className='mt-4'>
        <ul className='grid grid-cols-2 gap-x-10 gap-y-2 text-xl'>
          {online.slice(0, MAX).map((d) => (
            <Row key={d.mac} d={d} />
          ))}
        </ul>
        {online.length > MAX && <div className='mt-3 text-base text-muted-foreground'>и ещё {online.length - MAX}</div>}
      </Tile>
    </>
  )
}
