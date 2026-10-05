import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, HardDrive } from 'lucide-react'
import { api } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import type { DiskInfo, DiskIoRate, DiskIoSnapshot, Snapshot } from '@/lib/types'
import { Meter } from '@/components/meter'
import { NoData } from '@/components/no-data'
import { Value } from '@/components/value'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DISK_READ_COLOR, DISK_WRITE_COLOR, IO_IDLE_THRESHOLD, IO_POLL_MS, Pill, diskHealth } from '@/features/system/disks'

// Мини-индикатор I/O: стрелки цветом потока, как в разделе «Диски»; оба потока ниже порога — «простой»
function IoMini({ rate }: { rate?: DiskIoRate }) {
  if (!rate) return null
  if (rate.readBps < IO_IDLE_THRESHOLD && rate.writeBps < IO_IDLE_THRESHOLD) return <span>простой</span>
  return (
    <span className='inline-flex items-center gap-2'>
      <span className='inline-flex items-center' style={{ color: DISK_READ_COLOR }}>
        <ArrowDown className='size-3' aria-hidden='true' />
        {formatBytes(rate.readBps)}/с
      </span>
      <span className='inline-flex items-center' style={{ color: DISK_WRITE_COLOR }}>
        <ArrowUp className='size-3' aria-hidden='true' />
        {formatBytes(rate.writeBps)}/с
      </span>
    </span>
  )
}

// Строка диска — одна ссылка в раздел «Диски»: состояние, заполнение по тем же порогам, температура и I/O
function DiskRow({ d, rate }: { d: DiskInfo; rate?: DiskIoRate }) {
  const health = diskHealth(d)
  const notMounted = d.state === 'missing' ? 'не подключён' : d.state === 'unmounted' ? 'не смонтирован' : 'нет данных'
  return (
    <Link to='/disks' className='block rounded-lg border p-3 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='min-w-0'>
          <div className='truncate text-sm font-medium'>{d.mount ?? d.device}</div>
          <div className='truncate text-xs text-muted-foreground'>{[d.model, d.transport?.toUpperCase()].filter(Boolean).join(' · ') || d.device}</div>
        </div>
        <Pill level={health.level} icon={health.icon} title={health.title}>
          {health.label}
        </Pill>
      </div>
      {d.percent == null ? (
        <p className='mt-2 text-xs text-danger-foreground'>{notMounted}</p>
      ) : (
        <>
          <div className='mt-2 flex items-center gap-3'>
            <Meter value={d.percent} direction='higher-worse' className='h-1.5 flex-1' label={`Заполнение ${d.mount ?? d.device}`} />
            <Value kind='percent' value={d.percent} direction='higher-worse' className='w-12 justify-end font-semibold' />
          </div>
          <div className='mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums'>
            <span>
              {formatBytes(d.used, 1)} из {formatBytes(d.size)} · свободно {formatBytes(d.free)}
            </span>
            <span className='inline-flex flex-wrap items-center gap-3'>
              {d.smart?.temperature != null && <Value kind='temp-disk' value={d.smart.temperature} />}
              <IoMini rate={rate} />
            </span>
          </div>
        </>
      )}
    </Link>
  )
}

// Сводка дисков на Обзоре: компактнее карточек раздела «Диски», но та же шкала и те же статусы
export function DisksCard({ snapshot: s }: { snapshot: Snapshot | null | undefined }) {
  const { data: io } = useQuery({
    queryKey: ['disks-io'],
    queryFn: async () => (await api.get<DiskIoSnapshot>('/system/disks/io')).data,
    refetchInterval: IO_POLL_MS,
  })
  const disks = s?.disks?.filter((d) => d.mount && d.mount !== '/boot/efi')
  return (
    <Card className='gap-3'>
      <CardHeader className='flex flex-row items-center justify-between space-y-0'>
        <CardTitle className='text-sm font-medium'>Диски</CardTitle>
        <HardDrive className='size-4 text-muted-foreground' aria-hidden='true' />
      </CardHeader>
      <CardContent className='grid gap-2 sm:grid-cols-2'>
        {!s ? (
          <span className='text-sm text-muted-foreground'>Загрузка…</span>
        ) : !disks ? (
          <NoData reason={s.errors.disks?.message ?? null} />
        ) : (
          disks.map((d) => <DiskRow key={d.device} d={d} rate={io?.disks[d.disk.replace(/^\/dev\//, '')]} />)
        )}
      </CardContent>
    </Card>
  )
}
