import { useQuery } from '@tanstack/react-query'
import { CircleCheck, CircleX, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { meQuery } from '@/lib/auth'
import { ComingSoon } from '@/components/coming-soon'
import { Page } from '@/components/layout/page'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Health = {
  status: 'ok'
  version: string
  uptimeSec: number
  node: string
  memoryMb: number
}

const NETWORK_LABEL = { lan: 'локальная сеть', vpn: 'WireGuard VPN', local: 'localhost' }

function formatUptime(sec: number) {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return [d && `${d} д`, (d || h) && `${h} ч`, `${m} мин`].filter(Boolean).join(' ')
}

export function Overview() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => (await api.get<Health>('/health')).data,
    refetchInterval: 10_000,
  })
  const { data: me } = useQuery(meQuery)

  return (
    <Page title='Обзор' description='Состояние сервера Mac Mini'>
      <div className='mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        <Card>
          <CardHeader>
            <CardTitle className='text-sm font-medium'>Бэкенд панели</CardTitle>
          </CardHeader>
          <CardContent className='space-y-1 text-sm'>
            {health.isPending ? (
              <Loader2 className='animate-spin' />
            ) : health.isError ? (
              <p className='flex items-center gap-2 text-red-600'>
                <CircleX className='size-4' /> 🔴 не отвечает
              </p>
            ) : (
              <>
                <p className='flex items-center gap-2 text-green-600'>
                  <CircleCheck className='size-4' /> 🟢 работает
                </p>
                <p className='text-muted-foreground'>
                  Версия {health.data.version} · Node {health.data.node}
                </p>
                <p className='text-muted-foreground'>
                  Аптайм {formatUptime(health.data.uptimeSec)} · {health.data.memoryMb} МБ RAM
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='text-sm font-medium'>Ваше подключение</CardTitle>
          </CardHeader>
          <CardContent className='space-y-1 text-sm'>
            <p>{me?.ip ?? '…'}</p>
            <p className='text-muted-foreground'>
              {me ? NETWORK_LABEL[me.network] : ''}
            </p>
            {me && (
              <p className='text-muted-foreground'>
                Сессия до {new Date(me.expiresAt).toLocaleDateString('ru-RU')}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      <ComingSoon stage={2} />
    </Page>
  )
}
