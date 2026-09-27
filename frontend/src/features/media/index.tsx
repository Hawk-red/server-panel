import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Pause, Play, Speaker } from 'lucide-react'
import { api } from '@/lib/api'
import { formatRelative } from '@/lib/format'
import type { MediaData } from '@/lib/types'
import { Page } from '@/components/layout/page'
import { NoData } from '@/components/no-data'
import { containerStatus, ServiceCard, webUrl } from '@/components/service-card'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function Media() {
  const { data } = useQuery({
    queryKey: ['media'],
    queryFn: async () => (await api.get<MediaData>('/media')).data,
    refetchInterval: 10_000,
  })
  const jf = data?.jellyfin
  const mz = data?.marantz

  return (
    <Page title='Медиа' description='Стек /home/macmini/audio-streaming и ресивер'>
      <div className='grid gap-4 md:grid-cols-2'>
        <ServiceCard
          title='Jellyfin'
          icon='jellyfin'
          description='Медиасервер, музыка с /mnt/flac-usb'
          status={containerStatus(jf?.container)}
          version={jf?.info.data?.version ?? jf?.container.data?.version}
          ports={[8096]}
          url={webUrl(8096, '/web/')}
          container={jf?.container}
          invalidate={['media']}
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

        <ServiceCard
          title='MinimServer'
          icon='minimserver'
          description='UPnP/DLNA-сервер FLAC-музыки'
          status={containerStatus(data?.minimserver.container)}
          version={data?.minimserver.container.data?.version}
          ports={[9790, 9791]}
          url={webUrl(9790)}
          container={data?.minimserver.container}
          invalidate={['media']}
        />

        <ServiceCard
          title='BubbleUPnP Server'
          description='UPnP-сервер и транскодер для BubbleUPnP'
          status={containerStatus(data?.bubbleupnpserver.container)}
          version={data?.bubbleupnpserver.container.data?.version}
          ports={[58050, 58051]}
          url={webUrl(58050)}
          container={data?.bubbleupnpserver.container}
          invalidate={['media']}
        />

        <Card className='gap-3'>
          <CardHeader className='flex flex-row items-start gap-3'>
            <Speaker className='size-10 shrink-0 text-muted-foreground' />
            <div className='min-w-0 flex-1'>
              <CardTitle className='text-base'>Marantz NR1604</CardTitle>
              <p className='text-xs text-muted-foreground'>AV-ресивер, 192.168.31.94</p>
            </div>
            {mz?.error ? (
              <StatusBadge status='unknown' />
            ) : (
              <StatusBadge status={mz?.data?.online ? 'ok' : 'error'} label={mz?.data?.online ? 'в сети' : 'не в сети'} />
            )}
          </CardHeader>
          <CardContent className='space-y-3 text-sm'>
            <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'>
              <dt className='text-muted-foreground'>Питание</dt>
              <dd>{mz?.data?.power ? (mz.data.power === 'ON' ? 'включён' : 'в режиме ожидания') : <NoData />}</dd>
              <dt className='text-muted-foreground'>Вход</dt>
              <dd>{mz?.data?.source ?? <NoData />}</dd>
              <dt className='text-muted-foreground'>Веб-интерфейс</dt>
              <dd>
                <span className='font-mono text-address'>192.168.31.94:80</span>
              </dd>
            </dl>
            <Button size='sm' asChild>
              {/* Настоящий веб-интерфейс — порт 80 (/ → index.asp → top.asp); на :8080 только заглушка UPnP */}
              <a href='http://192.168.31.94/' target='_blank' rel='noreferrer'>
                <ExternalLink /> Открыть
              </a>
            </Button>
            <p className='text-xs text-muted-foreground'>Веб-интерфейс ресивера открывается только из домашней сети.</p>
          </CardContent>
        </Card>
      </div>
    </Page>
  )
}
