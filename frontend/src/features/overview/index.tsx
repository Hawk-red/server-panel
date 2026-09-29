import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Activity, CircleAlert, CircleCheck, Clock, Cpu, HardDrive, MemoryStick, Network, Thermometer, TriangleAlert, Tv } from 'lucide-react'
import { api } from '@/lib/api'
import type { BackupItem, InternetStatus } from '@/features/infra-types'
import { meQuery } from '@/lib/auth'
import type { Overview as OverviewData, Problem } from '@/lib/types'
import { Page } from '@/components/layout/page'
import { NoData } from '@/components/no-data'
import { Meter } from '@/components/meter'
import { StatTile } from '@/components/stat-tile'
import { Value } from '@/components/value'
import { formatUptimeScales } from '@/lib/format'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DeadlinesCard } from './deadlines-card'
import { ProblemSheet } from './problem-sheet'
import { QuickActions } from './quick-actions'
import { UptimeCard } from './uptime-card'

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
  const [openProblem, setOpenProblem] = useState<Problem | null>(null)
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
  const internet = useQuery({ queryKey: ['internet'], queryFn: async () => (await api.get<InternetStatus>('/internet')).data, refetchInterval: 15_000 })
  const backups = useQuery({ queryKey: ['backups'], queryFn: async () => (await api.get<{ items: BackupItem[] }>('/backups')).data.items, refetchInterval: 60_000 })
  const staleBackups = backups.data?.filter((b) => b.type === 'scheduled' && (b.status === 'stale' || b.status === 'missing')) ?? []

  const o = overview.data
  const s = o?.snapshot
  const err = (name: string) => s?.errors[name]?.message ?? null
  const net = s?.network?.[LAN_IFACE]
  const mem = s?.memory

  return (
    <Page
      title='Обзор'
      description='Состояние сервера Mac Mini'
      actions={
        <Button variant='outline' asChild>
          <Link to='/tv'>
            <Tv /> Режим ТВ
          </Link>
        </Button>
      }
    >
      <div className='grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6'>
        <StatTile
          title='CPU'
          icon={Cpu}
          value={s?.cpu ? <Value kind='percent' value={s.cpu.total} direction='higher-worse' /> : null}
          sub={s?.load ? `нагрузка ${s.load.l1.toFixed(2)} / ${s.load.l5.toFixed(2)} / ${s.load.l15.toFixed(2)}` : undefined}
          percent={s?.cpu?.total}
          direction='higher-worse'
          noDataReason={err('cpu')}
        />
        <StatTile
          title='Температура'
          icon={Thermometer}
          value={s?.temperature ? <Value kind='temp-cpu' value={s.temperature.cpu} /> : null}
          sub={
            s?.fan ? (
              <>
                вентилятор <Value kind='count' value={s.fan.rpm} /> об/мин
              </>
            ) : (
              'вентилятор: нет данных'
            )
          }
          noDataReason={err('temperature')}
        />
        <StatTile
          title='Память'
          icon={MemoryStick}
          value={mem ? <Value kind='bytes' value={mem.used} /> : null}
          sub={
            mem ? (
              <>
                из <Value kind='bytes' value={mem.total} /> · <Value kind='percent' value={(mem.used / mem.total) * 100} direction='higher-worse' /> · swap{' '}
                <Value kind='bytes' value={mem.swapUsed} />
              </>
            ) : undefined
          }
          percent={mem ? (mem.used / mem.total) * 100 : null}
          direction='higher-worse'
          noDataReason={err('memory')}
        />
        <StatTile
          title='Аптайм'
          icon={Clock}
          value={s?.uptimeSec != null ? <Value kind='duration' value={s.uptimeSec} /> : null}
          sub={s?.uptimeSec != null ? formatUptimeScales(s.uptimeSec) : undefined}
          noDataReason={err('uptime')}
        />
        <StatTile
          title='Сеть (LAN)'
          icon={Network}
          value={net ? <Value kind='speed' value={net.rxBps} flow='rx' prefix='↓ ' /> : null}
          sub={net ? <Value kind='speed' value={net.txBps} flow='tx' prefix='↑ ' /> : undefined}
          noDataReason={err('network')}
        />
        <StatTile
          title='Службы'
          icon={Activity}
          value={
            o?.services ? (
              <>
                <Value kind='count' value={o.services.running} /> <span className='text-base font-normal text-muted-foreground'>работают</span>
              </>
            ) : null
          }
          sub={
            o?.services ? (
              o.services.failed > 0 ? (
                <span className='inline-flex items-center gap-1 text-danger-foreground'>
                  <CircleAlert className='size-3' /> упало: {o.services.failed}
                </span>
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
                        <span className='text-muted-foreground'>
                          <Value kind='bytes' value={d.used} /> из <Value kind='bytes' value={d.size} /> ·{' '}
                          <Value kind='percent' value={d.percent} direction='higher-worse' className='font-medium' />
                        </span>
                      )}
                    </div>
                    <Meter value={d.percent} direction='higher-worse' label={`Диск ${d.mount}`} />
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
              {o?.services ? (
                <>
                  <Value kind='count' value={o.services.running} /> работают · <Value kind='count' value={o.services.failed} className={o.services.failed ? 'text-danger-foreground' : undefined} /> упало
                </>
              ) : (
                <NoData />
              )}
            </SummaryRow>
            <SummaryRow label='Контейнеры' to='/docker'>
              {o?.containers ? (
                <>
                  <Value kind='count' value={o.containers.running} /> из <Value kind='count' value={o.containers.total} /> запущено
                </>
              ) : (
                <NoData />
              )}
            </SummaryRow>
            <SummaryRow label='Устройства в сети' to='/network'>
              {o?.devices ? (
                <>
                  <Value kind='count' value={o.devices.online} /> онлайн
                  {o.devices.unknown > 0 && (
                    <span className='text-warn-foreground'>
                      {' '}
                      · <Value kind='count' value={o.devices.unknown} className='text-warn-foreground' /> новых
                    </span>
                  )}
                </>
              ) : (
                <NoData />
              )}
            </SummaryRow>
            <SummaryRow label='Активные торренты' to='/torrents'>
              {o?.torrents ? <Value kind='count' value={o.torrents.active} /> : <NoData />}
            </SummaryRow>
            <SummaryRow label='Интернет' to='/internet'>
              {internet.data ? (
                internet.data.downSince ? (
                  <span className='inline-flex items-center gap-1 text-danger-foreground'>
                    <CircleAlert className='size-3.5' /> нет связи
                  </span>
                ) : internet.data.now?.main != null ? (
                  <>
                    есть · <Value kind='number' value={`${internet.data.now.main < 10 ? internet.data.now.main.toFixed(1) : Math.round(internet.data.now.main)} мс`} />
                  </>
                ) : (
                  'есть'
                )
              ) : (
                <NoData />
              )}
            </SummaryRow>
            <SummaryRow label='Бэкапы' to='/backups'>
              {backups.data ? (
                staleBackups.length > 0 ? (
                  <span className='inline-flex items-center gap-1 text-danger-foreground'>
                    <CircleAlert className='size-3.5' /> устарели: {staleBackups.length}
                  </span>
                ) : (
                  <span className='inline-flex items-center gap-1 text-ok-foreground'>
                    <CircleCheck className='size-3.5' /> свежие
                  </span>
                )
              ) : (
                <NoData />
              )}
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
            <SummaryRow label='Ваше подключение'>
              {me ? (
                <>
                  <Value kind='address' value={me.ip} /> · {NETWORK_LABEL[me.network]}
                </>
              ) : (
                '…'
              )}
            </SummaryRow>
          </CardContent>
        </Card>
      </div>

      <div className='mt-4 grid gap-4 lg:grid-cols-2'>
        <QuickActions />
        <DeadlinesCard />
      </div>

      <UptimeCard />

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
            <ul className='divide-y'>
              {o.problems.map((p, i) => (
                <li key={i}>
                  <button
                    type='button'
                    onClick={() => setOpenProblem(p)}
                    className='flex w-full items-start gap-2 rounded-md px-2 py-2 text-start text-sm hover:bg-muted focus-visible:bg-muted'
                  >
                    {p.level === 'error' ? (
                      <CircleAlert className='mt-0.5 size-4 shrink-0 text-danger-foreground' aria-label='ошибка' />
                    ) : (
                      <TriangleAlert className='mt-0.5 size-4 shrink-0 text-warn-foreground' aria-label='предупреждение' />
                    )}
                    <span className='min-w-0 flex-1 break-words'>{p.text}</span>
                    <span className='shrink-0 text-xs text-muted-foreground'>подробнее →</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <ProblemSheet problem={openProblem} onClose={() => setOpenProblem(null)} />
    </Page>
  )
}
