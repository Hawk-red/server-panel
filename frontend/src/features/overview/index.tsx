import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Activity, CircleAlert, Clock, Cpu, HardDrive, MemoryStick, Network, Thermometer, TriangleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { meQuery } from '@/lib/auth'
import { formatBps, formatBytes, formatDuration, formatPercent } from '@/lib/format'
import type { Overview as OverviewData } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Page } from '@/components/layout/page'
import { NoData } from '@/components/no-data'
import { StatTile } from '@/components/stat-tile'
import { StatusBadge } from '@/components/status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Health = { status: 'ok'; version: string; uptimeSec: number; node: string; memoryMb: number }

const NETWORK_LABEL = { lan: 'локальная сеть', vpn: 'WireGuard VPN', local: 'localhost' }
const LAN_IFACE = 'enp3s0f0'

function SummaryRow({ label, children, to }: { label: string; children: React.ReactNode; to?: string }) {
  const content = (
    <div className='flex items-center justify-between gap-2 py-1.5 text-sm'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='text-end font-medium'>{children}</span>
    </div>
  )
  return to ? (
    <Link to={to} className='block rounded px-1 hover:bg-muted'>
      {content}
    </Link>
  ) : (
    <div className='px-1'>{content}</div>
  )
}

export function Overview() {
  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: async () => (await api.get<OverviewData>('/overview')).data,
    refetchInterval: 10_000,
  })
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => (await api.get<Health>('/health')).data,
    refetchInterval: 15_000,
  })
  const { data: me } = useQuery(meQuery)

  const o = overview.data
  const s = o?.snapshot
  const err = (name: string) => s?.errors[name]?.message ?? null
  const net = s?.network?.[LAN_IFACE]
  const mem = s?.memory

  return (
    <Page title='Обзор' description='Состояние сервера Mac Mini'>
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6'>
        <StatTile
          title='CPU'
          icon={Cpu}
          value={s?.cpu ? formatPercent(s.cpu.total) : null}
          sub={s?.load ? `нагрузка ${s.load.l1.toFixed(2)} / ${s.load.l5.toFixed(2)} / ${s.load.l15.toFixed(2)}` : undefined}
          percent={s?.cpu?.total}
          noDataReason={err('cpu')}
        />
        <StatTile
          title='Температура'
          icon={Thermometer}
          value={s?.temperature ? `${Math.round(s.temperature.cpu)} °C` : null}
          sub={s?.fan ? `вентилятор ${s.fan.rpm} об/мин` : 'вентилятор: нет данных'}
          noDataReason={err('temperature')}
        />
        <StatTile
          title='Память'
          icon={MemoryStick}
          value={mem ? formatBytes(mem.used) : null}
          sub={mem ? `из ${formatBytes(mem.total)} · swap ${formatBytes(mem.swapUsed)}` : undefined}
          percent={mem ? (mem.used / mem.total) * 100 : null}
          noDataReason={err('memory')}
        />
        <StatTile title='Аптайм' icon={Clock} value={s?.uptimeSec != null ? formatDuration(s.uptimeSec) : null} noDataReason={err('uptime')} />
        <StatTile
          title='Сеть (LAN)'
          icon={Network}
          value={net ? `↓ ${formatBps(net.rxBps)}` : null}
          sub={net ? `↑ ${formatBps(net.txBps)}` : undefined}
          noDataReason={err('network')}
        />
        <StatTile
          title='Службы'
          icon={Activity}
          value={o?.services ? `${o.services.running} работают` : null}
          sub={
            o?.services ? (
              o.services.failed > 0 ? (
                <span className='text-red-600'>упало: {o.services.failed}</span>
              ) : (
                'упавших нет'
              )
            ) : undefined
          }
        />
      </div>

      <div className='mt-4 grid gap-4 lg:grid-cols-3'>
        <Card className='gap-2 lg:col-span-2'>
          <CardHeader className='flex flex-row items-center justify-between'>
            <CardTitle className='text-sm font-medium'>Диски</CardTitle>
            <HardDrive className='size-4 text-muted-foreground' />
          </CardHeader>
          <CardContent className='space-y-3'>
            {!s?.disks ? (
              <NoData reason={err('disks')} />
            ) : (
              s.disks
                .filter((d) => d.mount && d.mount !== '/boot/efi')
                .map((d) => (
                  <div key={d.device} className='space-y-1'>
                    <div className='flex flex-wrap items-baseline justify-between gap-x-2 text-sm'>
                      <span className='font-medium'>
                        {d.mount}
                        <span className='ms-2 text-xs font-normal text-muted-foreground'>{d.model ?? d.device}</span>
                      </span>
                      {d.state === 'missing' ? (
                        <StatusBadge status='error' label='не подключён' />
                      ) : (
                        <span className='text-muted-foreground tabular-nums'>
                          {formatBytes(d.used)} из {formatBytes(d.size)} · {formatPercent(d.percent)}
                        </span>
                      )}
                    </div>
                    {d.percent != null && (
                      <div className='h-2 overflow-hidden rounded-full bg-muted'>
                        <div
                          className={cn('h-full rounded-full', d.percent >= 90 ? 'bg-red-500' : d.percent >= 85 ? 'bg-yellow-500' : 'bg-primary')}
                          style={{ width: `${d.percent}%` }}
                        />
                      </div>
                    )}
                  </div>
                ))
            )}
          </CardContent>
        </Card>

        <Card className='gap-2'>
          <CardHeader>
            <CardTitle className='text-sm font-medium'>Сводка</CardTitle>
          </CardHeader>
          <CardContent className='divide-y'>
            <SummaryRow label='Службы' to='/system'>
              {o?.services ? `${o.services.running} работают · ${o.services.failed} упало` : <NoData />}
            </SummaryRow>
            <SummaryRow label='Контейнеры' to='/docker'>
              {o?.containers ? `${o.containers.running} из ${o.containers.total} запущено` : <NoData />}
            </SummaryRow>
            <SummaryRow label='Устройства в сети' to='/network'>
              {o?.devices ? `${o.devices.online} онлайн` : <NoData reason='появится на этапе 6' />}
            </SummaryRow>
            <SummaryRow label='Активные торренты' to='/torrents'>
              {o?.torrents ? o.torrents.active : <NoData reason='появится на этапе 3' />}
            </SummaryRow>
            <SummaryRow label='Бэкенд панели'>
              {health.isError ? (
                <StatusBadge status='error' />
              ) : health.data ? (
                <StatusBadge status='ok' label={`v${health.data.version} · ${health.data.memoryMb} МБ`} />
              ) : (
                <NoData />
              )}
            </SummaryRow>
            <SummaryRow label='Ваше подключение'>{me ? `${me.ip} · ${NETWORK_LABEL[me.network]}` : '…'}</SummaryRow>
          </CardContent>
        </Card>
      </div>

      <Card className='mt-4 gap-2'>
        <CardHeader>
          <CardTitle className='text-sm font-medium'>Проблемы</CardTitle>
        </CardHeader>
        <CardContent>
          {overview.isError ? (
            <NoData reason='бэкенд не ответил' />
          ) : !o ? (
            <span className='text-sm text-muted-foreground'>Загрузка…</span>
          ) : o.problems.length === 0 ? (
            <StatusBadge status='ok' label='Проблем не обнаружено' />
          ) : (
            <ul className='space-y-2'>
              {o.problems.map((p, i) => (
                <li key={i} className='flex items-start gap-2 text-sm'>
                  {p.level === 'error' ? (
                    <CircleAlert className='mt-0.5 size-4 shrink-0 text-red-600' />
                  ) : (
                    <TriangleAlert className='mt-0.5 size-4 shrink-0 text-yellow-600' />
                  )}
                  <span>{p.text}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </Page>
  )
}
