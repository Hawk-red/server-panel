import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { Overview as OverviewData } from '@/lib/types'
import { NoData } from '@/components/no-data'
import { StatusBadge } from '@/components/status-badge'
import { Value } from '@/components/value'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Строка сводки — ссылка в раздел. Только то, чего нет в плитках выше: без службы, аптайма и подключения
function SummaryRow({ label, to, children }: { label: string; to: string; children: ReactNode }) {
  return (
    <Link to={to} className='block rounded px-1 hover:bg-muted'>
      <div className='flex items-center justify-between gap-2 py-1.5 text-sm'>
        <span className='text-muted-foreground'>{label}</span>
        <span className='text-end font-medium'>{children}</span>
      </div>
    </Link>
  )
}

export function SummaryCard({ o, backupsStale }: { o: OverviewData | undefined; backupsStale: number | null }) {
  return (
    <Card className='gap-2'>
      <CardHeader>
        <CardTitle className='text-sm font-medium'>Сводка</CardTitle>
      </CardHeader>
      <CardContent className='divide-y'>
        <SummaryRow label='Службы' to='/system'>
          {o?.services ? (
            <>
              <Value kind='count' value={o.services.running} /> работают ·{' '}
              {o.services.failed > 0 ? <span className='text-danger-foreground'>упало: {o.services.failed}</span> : <span>сбоев нет</span>}
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
        <SummaryRow label='Бэкапы' to='/backups'>
          {backupsStale == null ? (
            <NoData />
          ) : backupsStale > 0 ? (
            <StatusBadge status='error' label={`устарели: ${backupsStale}`} />
          ) : (
            <StatusBadge status='ok' />
          )}
        </SummaryRow>
      </CardContent>
    </Card>
  )
}
