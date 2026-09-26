import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AxiosError } from 'axios'
import { ExternalLink, Play, RotateCw, ScrollText, Square } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatDuration } from '@/lib/format'
import type { Container, Part } from '@/lib/types'
import { ConfirmDialog } from './confirm-dialog'
import { NoData } from './no-data'
import { ServiceIcon } from './service-icon'
import { StatusBadge, type Status } from './status-badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

// Ссылка на веб-интерфейс — по тому же адресу, с которого открыта панель (LAN или VPN)
export function webUrl(port: number, path = '/') {
  return `${window.location.protocol}//${window.location.hostname}:${port}${path}`
}

type Action = 'start' | 'stop' | 'restart'
const LABEL: Record<Action, string> = { start: 'Запустить', stop: 'Остановить', restart: 'Перезапустить' }

export function containerStatus(c: Part<Container> | undefined): Status {
  const state = c?.data?.state
  if (!state) return 'unknown'
  return state === 'running' ? 'ok' : state === 'restarting' ? 'warning' : 'error'
}

type ServiceCardProps = {
  title: string
  icon?: string | null
  description?: string
  status: Status
  statusLabel?: string
  version?: string | null
  ports?: number[]
  url?: string | null
  uptimeSec?: number | null
  container?: Part<Container>
  invalidate?: string[]
  children?: React.ReactNode
}

// Карточка сервиса: название, иконка, статус, версия, порты, веб-интерфейс, аптайм, управление
export function ServiceCard({
  title,
  icon,
  description,
  status,
  statusLabel,
  version,
  ports,
  url,
  uptimeSec,
  container,
  invalidate = [],
  children,
}: ServiceCardProps) {
  const qc = useQueryClient()
  const [pending, setPending] = useState<Action | null>(null)
  const c = container?.data ?? null
  const control = useMutation({
    mutationFn: (a: Action) => api.post(`/docker/containers/${encodeURIComponent(c!.name)}/${a}`, {}),
    onSuccess: (_d, a) => {
      toast.success(`${title}: ${LABEL[a].toLowerCase()} — выполнено`)
      for (const k of invalidate) qc.invalidateQueries({ queryKey: [k] })
    },
    onError: (e) => toast.error(`${title}: ${(e instanceof AxiosError && e.response?.data?.message) || 'ошибка'}`),
    onSettled: () => setPending(null),
  })
  const uptime = uptimeSec ?? (c?.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : null)
  const running = c?.state === 'running'

  return (
    <Card className='gap-3'>
      <CardHeader className='flex flex-row items-start gap-3'>
        <ServiceIcon slug={icon} className='size-10 shrink-0' />
        <div className='min-w-0 flex-1'>
          <CardTitle className='text-base'>{title}</CardTitle>
          {description && <p className='text-xs text-muted-foreground'>{description}</p>}
        </div>
        <StatusBadge status={status} label={statusLabel} />
      </CardHeader>
      <CardContent className='space-y-3 text-sm'>
        <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'>
          <dt className='text-muted-foreground'>Версия</dt>
          <dd>{version ?? <NoData />}</dd>
          <dt className='text-muted-foreground'>Порт(ы)</dt>
          <dd>{ports?.length ? ports.join(', ') : '—'}</dd>
          <dt className='text-muted-foreground'>Аптайм</dt>
          <dd>{uptime != null ? formatDuration(uptime) : '—'}</dd>
        </dl>
        {children}
        <div className='flex flex-wrap gap-2'>
          {url && (
            <Button size='sm' asChild>
              <a href={url} target='_blank' rel='noreferrer'>
                <ExternalLink /> Открыть
              </a>
            </Button>
          )}
          {c && !c.protected && (
            <>
              {running ? (
                <Button size='sm' variant='outline' onClick={() => setPending('stop')}>
                  <Square /> Стоп
                </Button>
              ) : (
                <Button size='sm' variant='outline' onClick={() => setPending('start')}>
                  <Play /> Запуск
                </Button>
              )}
              <Button size='sm' variant='outline' onClick={() => setPending('restart')}>
                <RotateCw /> Рестарт
              </Button>
              <Button size='sm' variant='ghost' asChild>
                <Link to='/system' search={{ tab: 'logs', source: `container:${c.name}` }}>
                  <ScrollText /> Логи
                </Link>
              </Button>
            </>
          )}
        </div>
      </CardContent>
      {pending && c && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && !control.isPending && setPending(null)}
          title={`${LABEL[pending]} ${title}?`}
          desc={
            <div className='space-y-2'>
              <p>Контейнер {c.name}.</p>
              {pending !== 'start' && c.warning && <p className='font-medium text-red-600'>⚠ {c.warning}</p>}
            </div>
          }
          confirmText={LABEL[pending]}
          destructive={pending !== 'start'}
          isLoading={control.isPending}
          handleConfirm={() => control.mutate(pending)}
        />
      )}
    </Card>
  )
}
