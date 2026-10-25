import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight, Pause, Play, Speaker } from 'lucide-react'
import { api } from '@/lib/api'
import { formatRelative } from '@/lib/format'
import type { MediaData } from '@/lib/types'
import { Page } from '@/components/layout/page'
import { type Block, SortableBlocks } from '@/components/sortable-blocks'
import { NoData } from '@/components/no-data'
import { containerStatus, ServiceCard } from '@/components/service-card'
import { StatusBadge } from '@/components/status-badge'
import { Card, CardContent } from '@/components/ui/card'

export function Media() {
  const { data } = useQuery({
    queryKey: ['media'],
    queryFn: async () => (await api.get<MediaData>('/media')).data,
    refetchInterval: 10_000,
  })
  const jf = data?.jellyfin
  const mz = data?.marantz

  const blocks: Block[] = [
    {
      id: 'jellyfin',
      title: 'Jellyfin',
      node: (
        <ServiceCard
          title='Jellyfin'
          icon='jellyfin'
          description='Медиасервер, музыка с /mnt/flac-usb'
          status={containerStatus(jf?.container)}
          version={jf?.info.data?.version ?? jf?.container.data?.version}
          ports={[8096]}
          service='jellyfin'
          container={jf?.container}
          invalidate={['media']}
          monitorId='jellyfin'
        >
          <div className='space-y-1'>
            <div className='text-muted-foreground'>Активные сессии</div>
            {jf?.sessions.error ? (
              <NoData reason={jf.sessions.error} />
            ) : jf?.sessions.data?.length === 0 ? (
              <span className='text-muted-foreground'>никто не смотрит и не слушает</span>
            ) : (
              <ul className='space-y-1'>
                {jf?.sessions.data?.map((s, i) => (
                  <li key={i} className='flex items-start gap-2'>
                    {s.playing ? (
                      s.playing.paused ? (
                        <Pause className='mt-0.5 size-4 shrink-0' />
                      ) : (
                        <Play className='mt-0.5 size-4 shrink-0 text-ok-foreground' />
                      )
                    ) : (
                      <span className='mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/40' />
                    )}
                    <div className='min-w-0'>
                      <div className='truncate'>{s.playing ? s.playing.title : 'без воспроизведения'}</div>
                      <div className='text-xs text-muted-foreground'>
                        {s.user} · {s.device} ({s.client}){s.playing?.progress != null && ` · ${s.playing.progress}%`} · {formatRelative(s.lastActivity)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </ServiceCard>
      ),
    },
    {
      id: 'minimserver',
      title: 'MinimServer',
      node: (
        <ServiceCard
          title='MinimServer'
          icon='minimserver'
          description='UPnP/DLNA-сервер FLAC-музыки'
          status={containerStatus(data?.minimserver.container)}
          version={data?.minimserver.container.data?.version}
          ports={[9790, 9791]}
          service='minimserver'
          container={data?.minimserver.container}
          invalidate={['media']}
          monitorId='minimserver'
        />
      ),
    },
    {
      id: 'bubbleupnp',
      title: 'BubbleUPnP',
      node: (
        <ServiceCard
          title='BubbleUPnP Server'
          description='UPnP-сервер и транскодер для BubbleUPnP'
          status={containerStatus(data?.bubbleupnpserver.container)}
          version={data?.bubbleupnpserver.container.data?.version}
          ports={[58050, 58051]}
          service='bubbleupnp'
          container={data?.bubbleupnpserver.container}
          invalidate={['media']}
          monitorId='bubbleupnpserver'
        />
      ),
    },
    {
      id: 'marantz',
      title: 'Ресивер Marantz',
      node: (
        <Card className='py-3 transition-colors hover:bg-muted/50'>
          <CardContent>
            <Link to='/media-control' search={{ tab: 'marantz' }} className='flex items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring'>
              <Speaker className='size-8 shrink-0 text-muted-foreground' aria-hidden />
              <div className='min-w-0 flex-1'>
                <div className='truncate text-base font-semibold'>Ресивер Marantz</div>
                <div className='truncate text-xs text-muted-foreground'>
                  NR1604{mz?.data ? `, ${mz.data.host}` : ''}
                </div>
              </div>
              {mz?.error ? (
                <StatusBadge status='unknown' />
              ) : (
                <StatusBadge status={mz?.data?.online ? 'ok' : 'error'} label={mz?.data?.online ? 'в сети' : 'не в сети'} />
              )}
              <span className='inline-flex shrink-0 items-center gap-1 text-sm font-medium'>
                открыть <ArrowRight className='size-4' aria-hidden />
              </span>
            </Link>
          </CardContent>
        </Card>
      ),
    },
  ]

  return (
    <Page title='Медиа-серверы' description='Стек /home/macmini/audio-streaming' layoutPage='media'>
      <SortableBlocks grid blocks={blocks} className='grid gap-4 md:grid-cols-2' />
    </Page>
  )
}
