import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CircleAlert, Network, Tv, TriangleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import type { BackupItem, InternetStatus } from '@/features/infra-types'
import { meQuery } from '@/lib/auth'
import type { Overview as OverviewData, Problem } from '@/lib/types'
import { Page } from '@/components/layout/page'
import { type Block, SortableBlocks } from '@/components/sortable-blocks'
import { NoData } from '@/components/no-data'
import { StatTile } from '@/components/stat-tile'
import { Value } from '@/components/value'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DeadlinesCard } from './deadlines-card'
import { DisksCard } from './disks-card'
import { InternetCard } from './internet-card'
import { ProblemSheet } from './problem-sheet'
import { QuickActions } from './quick-actions'
import { ResourcesCard } from './resources-card'
import { StatusBanner } from './status-banner'
import { SummaryCard } from './summary-card'
import { UptimeCard } from './uptime-card'

type Health = { status: 'ok'; version: string; uptimeSec: number; node: string; memoryMb: number }

const NETWORK_LABEL = { lan: 'локальная сеть', vpn: 'WireGuard VPN', local: 'localhost' }
const LAN_IFACE = 'enp3s0f0'
// Раскладка Обзора хранится под своим ключом: старый порядок блоков не подходит к новой структуре
const LAYOUT_PAGE = 'overview-v2'
const PROBLEMS_ID = 'overview-problems'

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
  const problems = o?.problems ?? []
  const showProblems = () => document.getElementById(PROBLEMS_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const blocks: Block[] = [
    {
      id: 'status',
      title: 'Состояние',
      className: 'col-span-2 lg:col-span-3 xl:col-span-6',
      node: (
        <StatusBanner
          loading={!o}
          problems={problems}
          uptimeSec={s?.uptimeSec}
          panelVersion={health.data?.version}
          connection={me ? (
            <>
              вход с <Value kind='address' value={me.ip} /> · {NETWORK_LABEL[me.network]}
            </>
          ) : undefined}
          onShowProblems={showProblems}
        />
      ),
    },
    {
      id: 'problems',
      title: 'Проблемы',
      className: 'col-span-2 lg:col-span-3 xl:col-span-6',
      node: (
        <Card id={PROBLEMS_ID} className='gap-2'>
          <CardHeader>
            <CardTitle className='text-sm font-medium'>Проблемы</CardTitle>
          </CardHeader>
          <CardContent>
            {overview.isError ? (
              <NoData reason='бэкенд не ответил' />
            ) : !o ? (
              <span className='text-sm text-muted-foreground'>Загрузка…</span>
            ) : problems.length === 0 ? (
              <StatusBadge status='ok' label='проблем нет' />
            ) : (
              <ul className='divide-y'>
                {problems.map((p, i) => (
                  <li key={i}>
                    <button
                      type='button'
                      onClick={() => setOpenProblem(p)}
                      className='flex w-full items-start gap-2 rounded-md px-2 py-2 text-start text-sm hover:bg-muted focus-visible:bg-muted'
                    >
                      {p.level === 'error' ? (
                        <CircleAlert className='mt-0.5 size-4 shrink-0 text-danger-foreground' aria-label='сбой' />
                      ) : (
                        <TriangleAlert className='mt-0.5 size-4 shrink-0 text-warn-foreground' aria-label='внимание' />
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
      ),
    },
    { id: 'quick', title: 'Быстрые действия', className: 'col-span-2 lg:col-span-3 xl:col-span-6', node: <QuickActions /> },
    { id: 'availability', title: 'Доступность сервисов', className: 'col-span-2 lg:col-span-3 xl:col-span-6', node: <UptimeCard /> },
    { id: 'resources', title: 'Ресурсы сервера', className: 'col-span-2 lg:col-span-2 xl:col-span-4', node: <ResourcesCard snapshot={s} err={err} /> },
    {
      id: 'network',
      title: 'Сеть (LAN)',
      className: 'col-span-2 lg:col-span-1 xl:col-span-2',
      node: (
        <StatTile
          title='Сеть (LAN)'
          icon={Network}
          value={net ? <Value kind='speed' value={net.rxBps} flow='rx' prefix='↓ ' /> : null}
          sub={net ? <Value kind='speed' value={net.txBps} flow='tx' prefix='↑ ' /> : undefined}
          noDataReason={err('network')}
        />
      ),
    },
    { id: 'disks', title: 'Диски', className: 'col-span-2 lg:col-span-2 xl:col-span-4', node: <DisksCard snapshot={s} /> },
    {
      id: 'summary',
      title: 'Сводка',
      className: 'col-span-2 lg:col-span-1 xl:col-span-2',
      node: <SummaryCard o={o} backupsStale={backups.data ? staleBackups.length : null} />,
    },
    { id: 'deadlines', title: 'Сроки', className: 'col-span-2 lg:col-span-2 xl:col-span-3', node: <DeadlinesCard /> },
    { id: 'internet', title: 'Интернет', className: 'col-span-2 lg:col-span-1 xl:col-span-3', node: <InternetCard data={internet.data} isError={internet.isError} /> },
  ]

  return (
    <Page
      title='Обзор'
      description='Состояние сервера Mac Mini'
      layoutPage={LAYOUT_PAGE}
      actions={
        <Button variant='outline' asChild>
          <Link to='/tv'>
            <Tv /> Режим ТВ
          </Link>
        </Button>
      }
    >
      <SortableBlocks grid blocks={blocks} className='grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6' />
      <ProblemSheet problem={openProblem} onClose={() => setOpenProblem(null)} />
    </Page>
  )
}
