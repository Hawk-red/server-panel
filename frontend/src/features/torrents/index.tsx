import { useState } from 'react'
import { Value } from '@/components/value'
import { Meter } from '@/components/meter'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { Pause, Play, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatBps, formatDateTime } from '@/lib/format'
import type { MetricsResponse, Range, TorrentsData } from '@/lib/types'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Page } from '@/components/layout/page'
import { type Block, SortableBlocks } from '@/components/sortable-blocks'
import { MetricChart, RANGE_LABELS } from '@/components/metric-chart'
import { NoData } from '@/components/no-data'
import { containerStatus, ServiceCard, webUrl } from '@/components/service-card'
import { StatTile } from '@/components/stat-tile'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const SERIES = [
  { name: 'torrent.dl', label: 'Загрузка (приём)', color: 'var(--rx)' },
  { name: 'torrent.ul', label: 'Отдача', color: 'var(--tx)' },
]

function SpeedStats({ range }: { range: Range }) {
  // Тот же ключ, что у графика — данные берутся из общего кэша
  const { data } = useQuery({
    queryKey: ['metrics', range, SERIES.map((s) => s.name).join(',')],
    queryFn: async () => (await api.get<MetricsResponse>('/metrics', { params: { range, series: SERIES.map((s) => s.name).join(',') } })).data,
  })
  const stat = (name: string) => {
    const pts = data?.series[name] ?? []
    if (!pts.length) return null
    return { max: Math.max(...pts.map((p) => p[2])), avg: pts.reduce((a, p) => a + p[1], 0) / pts.length }
  }
  const dl = stat('torrent.dl')
  const ul = stat('torrent.ul')
  return (
    <p className='text-xs text-muted-foreground'>
      За период «{RANGE_LABELS[range].toLowerCase()}»: загрузка — макс. {dl ? formatBps(dl.max) : '—'}, средн. {dl ? formatBps(dl.avg) : '—'}; отдача — макс.{' '}
      {ul ? formatBps(ul.max) : '—'}, средн. {ul ? formatBps(ul.avg) : '—'}
    </p>
  )
}

export function Torrents() {
  const qc = useQueryClient()
  const [range, setRange] = useState<Range>('day')
  const [confirm, setConfirm] = useState<'stop-all' | 'start-all' | null>(null)
  const { data } = useQuery({
    queryKey: ['torrents'],
    queryFn: async () => (await api.get<TorrentsData>('/torrents')).data,
    refetchInterval: 5_000,
  })
  const bulk = useMutation({
    mutationFn: (a: 'stop-all' | 'start-all') => api.post(`/torrents/${a}`, {}),
    onSuccess: (_d, a) => {
      toast.success(a === 'stop-all' ? 'Все торренты поставлены на паузу' : 'Все торренты продолжены')
      qc.invalidateQueries({ queryKey: ['torrents'] })
    },
    onError: (e) => toast.error((e instanceof AxiosError && e.response?.data?.message) || 'ошибка'),
    onSettled: () => setConfirm(null),
  })
  const s = data?.summary.data
  const g = data?.guard.data

  const blocks: Block[] = [
    {
      id: 'service',
      title: 'qBittorrent',
      className: 'lg:col-span-1',
      node: (
        <ServiceCard
          title='qBittorrent'
          icon='qbittorrent'
          status={containerStatus(data?.container)}
          version={s?.version ?? data?.container.data?.version}
          ports={[8090, 6881]}
          url={webUrl(8090)}
          container={data?.container}
          invalidate={['torrents']}
          monitorId='qbittorrent'
        >
          <div className='flex flex-wrap gap-2'>
            <Button size='sm' variant='outline' disabled={!s} onClick={() => setConfirm('stop-all')}>
              <Pause /> Пауза всех
            </Button>
            <Button size='sm' variant='outline' disabled={!s} onClick={() => setConfirm('start-all')}>
              <Play /> Продолжить все
            </Button>
          </div>
          {data?.summary.error && <NoData reason={data.summary.error} />}
        </ServiceCard>
      ),
    },
    {
      id: 'stats',
      title: 'Статистика',
      className: 'lg:col-span-2',
      node: (
        <div className='grid gap-4 sm:grid-cols-2'>
          <StatTile
            title='Скорость сейчас'
            value={s ? <Value kind='speed' value={s.speed.dl} flow='rx' prefix='↓ ' /> : null}
            sub={s ? <Value kind='speed' value={s.speed.ul} flow='tx' prefix='↑ ' /> : undefined}
            noDataReason={data?.summary.error}
          />
          <StatTile
            title='Торренты'
            value={
              s ? (
                <>
                  <Value kind='count' value={s.counts.total} /> <span className='text-base font-normal text-muted-foreground'>всего</span>
                </>
              ) : null
            }
            sub={s ? `качается ${s.counts.downloading} · раздаётся ${s.counts.seeding} · на паузе ${s.counts.stopped}${s.counts.errored ? ` · ошибок ${s.counts.errored}` : ''}` : undefined}
          />
          <StatTile
            title='За сессию'
            value={s ? <Value kind='bytes' value={s.session.dl} flow='rx' prefix='↓ ' /> : null}
            sub={s ? <Value kind='bytes' value={s.session.ul} flow='tx' prefix='↑ ' /> : undefined}
          />
          <StatTile
            title='За всё время'
            value={s ? <Value kind='bytes' value={s.alltime.dl} flow='rx' prefix='↓ ' /> : null}
            sub={
              s ? (
                <>
                  <Value kind='bytes' value={s.alltime.ul} flow='tx' prefix='↑ ' /> · рейтинг <Value kind='number' value={s.alltime.ratio} digits={2} />
                </>
              ) : undefined
            }
          />
        </div>
      ),
    },
    {
      id: 'speed',
      title: 'График скорости',
      className: 'lg:col-span-3',
      node: (
      <div className='space-y-2'>
        <div className='flex flex-wrap gap-2'>
          {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
            <Button key={r} size='sm' variant={r === range ? 'default' : 'outline'} onClick={() => setRange(r)}>
              {RANGE_LABELS[r]}
            </Button>
          ))}
        </div>
        <MetricChart title='Скорость' series={SERIES} range={range} format={formatBps} domain={[0, 'auto']} />
        <SpeedStats range={range} />
      </div>
      ),
    },
    {
      id: 'active',
      title: 'Активные торренты',
      className: 'lg:col-span-3',
      node: (
      <Card className='gap-2'>
        <CardHeader>
          <CardTitle className='text-sm font-medium'>Активные торренты</CardTitle>
        </CardHeader>
        <CardContent>
          {!s ? (
            <NoData reason={data?.summary.error} />
          ) : s.active.length === 0 ? (
            <span className='text-sm text-muted-foreground'>Сейчас ничего не качается и не раздаётся.</span>
          ) : (
            <div className='overflow-x-auto rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Имя</TableHead>
                    <TableHead>Прогресс</TableHead>
                    <TableHead>Скорость</TableHead>
                    <TableHead className='hidden md:table-cell'>Сиды / пиры</TableHead>
                    <TableHead className='hidden sm:table-cell'>ETA</TableHead>
                    <TableHead className='hidden sm:table-cell'>Размер</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.active.map((t) => (
                    <TableRow key={t.hash}>
                      <TableCell className='max-w-[20rem] truncate' title={t.name}>
                        {t.name}
                      </TableCell>
                      <TableCell className='min-w-28'>
                        <Value kind='percent' value={t.progress * 100} digits={1} direction='neutral' className='text-xs' />
                        <Meter value={t.progress * 100} direction='neutral' className='h-1.5' label='Прогресс' />
                      </TableCell>
                      <TableCell className='whitespace-nowrap text-xs tabular-nums'>
                        <Value kind='speed' value={t.dlspeed} flow='rx' prefix='↓ ' />
                        <br />
                        <Value kind='speed' value={t.upspeed} flow='tx' prefix='↑ ' />
                      </TableCell>
                      <TableCell className='hidden tabular-nums md:table-cell'>
                        {t.seeds} ({t.seedsTotal}) / {t.peers} ({t.peersTotal})
                      </TableCell>
                      <TableCell className='hidden whitespace-nowrap sm:table-cell'>{t.eta != null ? <Value kind='duration' value={t.eta} /> : '∞'}</TableCell>
                      <TableCell className='hidden whitespace-nowrap sm:table-cell'>
                        <Value kind='bytes' value={t.size} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      ),
    },
    {
      id: 'guard',
      title: 'Защита места',
      className: 'lg:col-span-3',
      node: (
      <Card className='gap-2'>
        <CardHeader>
          <CardTitle className='text-sm font-medium'>Защита места (torrent-space-guard.sh, каждые 5 мин)</CardTitle>
        </CardHeader>
        <CardContent className='space-y-2 text-sm'>
          {!g ? (
            <NoData reason={data?.guard.error} />
          ) : (
            <>
              {g.mismatch && (
                <p className='flex items-start gap-2 font-medium text-warn-foreground'>
                  <TriangleAlert className='mt-0.5 size-4 shrink-0' />
                  Скрипт проверяет {g.watchedPath}, а закачки идут в {g.downloadsPath} (другой диск) — корневой SSD он не защищает.
                </p>
              )}
              <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'>
                <dt className='text-muted-foreground'>Пороги</dt>
                <dd>
                  пауза при &lt; {g.thresholdGb ?? '?'} ГБ, продолжение при &gt; {g.resumeGb ?? '?'} ГБ
                </dd>
                <dt className='text-muted-foreground'>Проверяет</dt>
                <dd>
                  <Value kind='address' value={g.watchedPath ?? '—'} />: свободно <Value kind='bytes' value={g.watchedFree} />
                </dd>
                <dt className='text-muted-foreground'>Закачки</dt>
                <dd>
                  <Value kind='address' value={g.downloadsPath} />: свободно <Value kind='bytes' value={g.downloadsFree} /> из{' '}
                  <Value kind='bytes' value={g.downloadsTotal} />
                </dd>
                <dt className='text-muted-foreground'>Последняя пауза</dt>
                <dd>{g.lastPause ? `${formatDateTime(g.lastPause.at)} — ${g.lastPause.text.replace(/^\S+ \S+ /, '')}` : 'ни разу не ставил'}</dd>
              </dl>
            </>
          )}
        </CardContent>
      </Card>
      ),
    },
  ]

  return (
    <Page title='Торренты' description='qBittorrent: состояние и статистика; добавлять торренты — в родном интерфейсе' layoutPage='torrents'>
      <SortableBlocks grid blocks={blocks} className='grid gap-4 lg:grid-cols-3' />
      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && !bulk.isPending && setConfirm(null)}
          title={confirm === 'stop-all' ? 'Поставить все торренты на паузу?' : 'Продолжить все торренты?'}
          desc={confirm === 'stop-all' ? 'Остановятся и закачки, и раздачи.' : 'Все торренты, включая поставленные на паузу вручную, продолжат работу.'}
          confirmText={confirm === 'stop-all' ? 'Пауза всех' : 'Продолжить'}
          destructive={confirm === 'stop-all'}
          isLoading={bulk.isPending}
          handleConfirm={() => bulk.mutate(confirm)}
        />
      )}
    </Page>
  )
}
