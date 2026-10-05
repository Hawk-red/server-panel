import { useState } from 'react'
import { Value } from '@/components/value'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { Shield, ShieldOff, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatDuration } from '@/lib/format'
import type { AdguardData, Range } from '@/lib/types'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Page } from '@/components/layout/page'
import { type Block, SortableBlocks } from '@/components/sortable-blocks'
import { MetricChart, RANGE_LABELS } from '@/components/metric-chart'
import { NoData } from '@/components/no-data'
import { containerStatus, ServiceCard } from '@/components/service-card'
import { StatTile } from '@/components/stat-tile'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const QUERYLOG_WARN = 1024 ** 3 // 1 ГБ
const OFF_OPTIONS: { label: string; minutes?: number }[] = [
  { label: '1 мин', minutes: 1 },
  { label: '10 мин', minutes: 10 },
  { label: '1 час', minutes: 60 },
  { label: 'до включения' },
]

function TopList({ title, items }: { title: string; items?: { name: string; count: number }[] }) {
  const max = Math.max(1, ...(items ?? []).map((i) => i.count))
  return (
    <Card className='gap-2'>
      <CardHeader>
        <CardTitle className='text-sm font-medium'>{title}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-1.5'>
        {!items ? (
          <NoData />
        ) : items.length === 0 ? (
          <span className='text-sm text-muted-foreground'>пусто</span>
        ) : (
          items.map((i) => (
            <div key={i.name} className='text-sm'>
              <div className='flex justify-between gap-2'>
                <span className='truncate'>{i.name}</span>
                <Value kind='count' value={i.count} className='font-medium' />
              </div>
              <div className='h-1 overflow-hidden rounded-full bg-muted'>
                <div className='h-full bg-info/70' style={{ width: `${(i.count / max) * 100}%` }} />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

export function Adguard() {
  const qc = useQueryClient()
  const [range, setRange] = useState<Range>('day')
  const [confirm, setConfirm] = useState<{ enabled: boolean; minutes?: number; label: string } | null>(null)
  const { data } = useQuery({
    queryKey: ['adguard'],
    queryFn: async () => (await api.get<AdguardData>('/adguard')).data,
    refetchInterval: 10_000,
  })
  const protection = useMutation({
    mutationFn: (b: { enabled: boolean; minutes?: number }) => api.post('/adguard/protection', b),
    onSuccess: (_d, b) => {
      toast.success(b.enabled ? 'Защита включена' : 'Защита выключена')
      qc.invalidateQueries({ queryKey: ['adguard'] })
    },
    onError: (e) => toast.error((e instanceof AxiosError && e.response?.data?.message) || 'ошибка'),
    onSettled: () => setConfirm(null),
  })
  const st = data?.status.data
  const stats = data?.stats.data
  const qlog = data?.querylogSize.data
  const intervalDays = data?.interval.data ? Math.round(data.interval.data / 86_400_000) : null

  const blocks: Block[] = [
    {
      id: 'service',
      title: 'AdGuard Home',
      className: 'md:col-span-2 lg:col-span-2',
      node: (
        <ServiceCard
          title='AdGuard Home'
          icon='adguard-home'
          status={containerStatus(data?.container)}
          version={st?.version ?? data?.container.data?.version}
          ports={[53, 3000]}
          service='adguard'
          container={data?.container}
          invalidate={['adguard']}
          monitorId='adguardhome'
        >
          <div className='space-y-2'>
            <div className='flex items-center justify-between gap-2'>
              <span className='text-muted-foreground'>Защита</span>
              {!st ? (
                <NoData reason={data?.status.error} />
              ) : st.protection_enabled ? (
                <StatusBadge status='ok' label='включена' />
              ) : (
                <StatusBadge
                  status='warning'
                  label={st.protection_disabled_duration ? `выключена ещё на ${formatDuration(Math.round(st.protection_disabled_duration / 1000))}` : 'выключена'}
                />
              )}
            </div>
            {st && (
              <div className='flex flex-wrap gap-2'>
                {st.protection_enabled ? (
                  OFF_OPTIONS.map((o) => (
                    <Button key={o.label} size='sm' variant='outline' onClick={() => setConfirm({ enabled: false, minutes: o.minutes, label: o.label })}>
                      <ShieldOff /> {o.label}
                    </Button>
                  ))
                ) : (
                  <Button size='sm' onClick={() => protection.mutate({ enabled: true })} disabled={protection.isPending}>
                    <Shield /> Включить защиту
                  </Button>
                )}
              </div>
            )}
          </div>
        </ServiceCard>
      ),
    },
    {
      id: 'stats',
      title: 'Статистика',
      className: 'md:col-span-2 lg:col-span-4',
      node: (
        <div className='grid gap-4 sm:grid-cols-2'>
          <StatTile
            title='DNS-запросов'
            value={stats ? <Value kind='count' value={stats.queries} /> : null}
            sub={intervalDays ? `за ${intervalDays} д (настройка статистики AdGuard)` : undefined}
            noDataReason={data?.stats.error}
          />
          <StatTile
            title='Заблокировано'
            value={stats ? <Value kind='count' value={stats.blocked} /> : null}
            sub={
              stats ? (
                <>
                  <Value kind='percent' value={stats.blockedPercent} digits={1} direction='neutral' /> запросов
                </>
              ) : undefined
            }
            percent={stats?.blockedPercent}
            direction='neutral'
          />
          <StatTile title='Среднее время ответа' value={stats ? <Value kind='number' value={stats.avgMs} suffix=' мс' /> : null} />
          <StatTile
            title='Журнал запросов'
            value={qlog != null ? <Value kind='bytes' value={qlog} /> : null}
            sub={
              qlog != null && qlog > QUERYLOG_WARN ? (
                <span className='flex items-center gap-1 text-warn-foreground'>
                  <TriangleAlert className='size-3' /> большой и растёт — сократите срок хранения в настройках AdGuard
                </span>
              ) : (
                'querylog.json'
              )
            }
            noDataReason='нет прав на чтение размера (sudoers)'
          />
        </div>
      ),
    },
    {
      id: 'chart',
      title: 'График запросов',
      className: 'md:col-span-2 lg:col-span-6',
      node: (
      <div className='space-y-2'>
        <div className='flex flex-wrap gap-2'>
          {(['day', 'week', 'month', 'quarter'] as Range[]).map((r) => (
            <Button key={r} size='sm' variant={r === range ? 'default' : 'outline'} onClick={() => setRange(r)}>
              {RANGE_LABELS[r]}
            </Button>
          ))}
        </div>
        <MetricChart
          title='Запросы и блокировки'
          series={[
            { name: 'adguard.queries', label: 'Запросы', color: 'var(--info)' },
            { name: 'adguard.blocked', label: 'Заблокировано', color: 'var(--brand)' },
          ]}
          range={range}
          format={(v) => Math.round(v).toLocaleString('ru-RU')}
          domain={[0, 'auto']}
        />
        <p className='text-xs text-muted-foreground'>История копится панелью по часам с момента запуска этапа 3 (за первые сутки — из статистики AdGuard).</p>
      </div>
      ),
    },
    {
      id: 'top-clients',
      title: 'Топ клиентов',
      className: 'md:col-span-1 lg:col-span-3',
      node: (
        <TopList title='Топ клиентов' items={stats?.topClients} />
      ),
    },
    {
      id: 'top-blocked',
      title: 'Топ заблокированных доменов',
      className: 'md:col-span-1 lg:col-span-3',
      node: (
        <TopList title='Топ заблокированных доменов' items={stats?.topBlocked} />
      ),
    },
  ]

  return (
    <Page title='AdGuard Home' description='DNS-фильтр для домашней сети и VPN' layoutPage='adguard'>
      <SortableBlocks grid blocks={blocks} className='grid gap-4 md:grid-cols-2 lg:grid-cols-6' />
      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && !protection.isPending && setConfirm(null)}
          title={`Выключить защиту AdGuard (${confirm.label})?`}
          desc={
            confirm.minutes
              ? `Реклама и трекеры перестанут блокироваться на ${confirm.label}; потом защита включится сама.`
              : 'Реклама и трекеры перестанут блокироваться, пока вы не включите защиту вручную.'
          }
          confirmText='Выключить'
          destructive
          isLoading={protection.isPending}
          handleConfirm={() => protection.mutate({ enabled: false, minutes: confirm.minutes })}
        />
      )}
    </Page>
  )
}
