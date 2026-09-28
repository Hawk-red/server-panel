import { useQuery } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, CircleHelp, Clock, Database, HardDrive, TriangleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDateTime, formatRelative } from '@/lib/format'
import type { BackupItem } from '@/features/infra-types'
import { Page } from '@/components/layout/page'
import { NoData } from '@/components/no-data'
import { Value } from '@/components/value'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function ageText(sec: number | null) {
  if (sec == null) return '—'
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} мин назад`
  if (sec < 48 * 3600) return `${Math.round(sec / 3600)} ч назад`
  return `${Math.round(sec / 86400)} дн. назад`
}

// Статус всегда со значком и словом — не только цветом
function StatusMark({ b }: { b: BackupItem }) {
  if (b.type === 'oneoff') return <span className='inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium text-muted-foreground'><Clock className='size-4' /> разовые копии</span>
  switch (b.status) {
    case 'ok':
      return <span className='inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium text-ok-foreground'><CircleCheck className='size-4' /> свежая</span>
    case 'stale':
      return <span className='inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium text-danger-foreground'><CircleAlert className='size-4' /> устарела</span>
    case 'missing':
      return <span className='inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium text-danger-foreground'><CircleAlert className='size-4' /> копий нет</span>
    default:
      return <span className='inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium text-muted-foreground'><CircleHelp className='size-4' /> нет данных</span>
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex items-baseline justify-between gap-3 py-1.5 text-sm'>
      <span className='shrink-0 text-muted-foreground'>{label}</span>
      <span className='min-w-0 text-end font-medium break-words'>{children}</span>
    </div>
  )
}

const SYNC_STATUS = {
  ok: { text: 'без ошибок', cls: 'text-ok-foreground' },
  warnings: { text: 'с предупреждениями', cls: 'text-warn-foreground' },
  'running-or-failed': { text: 'не завершён или упал', cls: 'text-danger-foreground' },
} as const

function BackupCard({ b }: { b: BackupItem }) {
  const sync = b.extra?.sync
  return (
    <Card className='gap-2'>
      <CardHeader className='flex flex-row items-start justify-between gap-2'>
        <div className='min-w-0'>
          <CardTitle className='flex items-center gap-2 text-base'>
            <Database className='size-4 shrink-0 text-volume' aria-hidden='true' /> {b.title}
          </CardTitle>
          <p className='mt-1 text-xs text-muted-foreground'>{b.description}</p>
        </div>
        <StatusMark b={b} />
      </CardHeader>
      <CardContent className='divide-y'>
        {b.status === 'nodata' && b.type === 'scheduled' ? (
          <div className='space-y-1 py-2 text-sm'>
            <NoData reason={b.note} />
            {b.note && <p className='text-xs text-warn-foreground'>Причина: {b.note}</p>}
          </div>
        ) : (
          <>
            {b.type === 'scheduled' && (
              <Row label='Последняя копия'>
                {b.latest ? (
                  <>
                    <span className={b.status === 'ok' ? '' : 'text-danger-foreground'}>{ageText(b.ageSec)}</span>
                    <span className='block text-xs font-normal text-muted-foreground'>{formatDateTime(b.latest.mtime)} · {b.latest.name}</span>
                  </>
                ) : (
                  <span className='text-danger-foreground'>нет</span>
                )}
              </Row>
            )}
            {b.maxAgeH != null && <Row label='Считается устаревшей'>старше <Value kind='count' value={b.maxAgeH} /> ч</Row>}
            <Row label='Копий хранится'>{b.count != null ? <Value kind='count' value={b.count} /> : '—'}</Row>
            {b.sizeBytes != null && b.type === 'scheduled' && <Row label='Размер последней'><Value kind='bytes' value={b.sizeBytes} /></Row>}
            <Row label={b.type === 'oneoff' ? 'Занимают всего' : 'Все копии вместе'}>
              {b.totalBytes != null ? <Value kind='bytes' value={b.totalBytes} /> : <span className='text-muted-foreground'>{b.extra?.sizesPending ? 'считается…' : '—'}</span>}
            </Row>
            {b.extra?.freeBytes != null && <Row label='Свободно на диске'><Value kind='bytes' value={b.extra.freeBytes} /></Row>}
            {sync && (
              <Row label='Последний синк'>
                {sync.finished ? formatDateTime(sync.finished) : 'не завершён'}
                <span className={`block text-xs font-normal ${SYNC_STATUS[sync.status].cls}`}>
                  {sync.status === 'ok' ? <CircleCheck className='me-1 inline size-3' /> : <TriangleAlert className='me-1 inline size-3' />}
                  {SYNC_STATUS[sync.status].text}
                  {sync.errors > 0 && ' — подробности в логе синка'}
                </span>
              </Row>
            )}
            <Row label='Путь'><Value kind='address' value={b.path} className='break-all' /></Row>
            {b.entries && b.entries.length > 0 && (
              <div className='py-2'>
                <div className='mb-1 text-xs font-medium text-muted-foreground'>{b.type === 'oneoff' ? 'Что лежит' : 'Последние снимки'}</div>
                <ul className='space-y-1 text-sm'>
                  {b.entries.map((e) => (
                    <li key={e.name} className='flex flex-wrap items-baseline justify-between gap-x-3'>
                      <span className='min-w-0'>
                        <span className='font-mono text-address'>{e.name}</span>
                        {e.note && <span className='block text-xs text-muted-foreground'>{e.note}</span>}
                      </span>
                      <span className='text-xs text-muted-foreground'>
                        {e.sizeBytes != null && <><Value kind='bytes' value={e.sizeBytes} /> · </>}
                        {e.mtime ? formatRelative(e.mtime) : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {b.note && (
              <p className='flex items-start gap-1.5 py-2 text-xs text-warn-foreground'>
                <TriangleAlert className='mt-0.5 size-3.5 shrink-0' /> {b.note}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function Backups() {
  const { data, isError } = useQuery({ queryKey: ['backups'], queryFn: async () => (await api.get<{ items: BackupItem[] }>('/backups')).data.items, refetchInterval: 30_000 })
  const bad = data?.filter((b) => b.type === 'scheduled' && (b.status === 'stale' || b.status === 'missing')) ?? []
  return (
    <Page title='Бэкапы' description='Свежесть и размер резервных копий на сервере'>
      {isError ? (
        <NoData reason='бэкенд не ответил' />
      ) : !data ? (
        <span className='text-sm text-muted-foreground'>Загрузка…</span>
      ) : (
        <>
          <div className='mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm'>
            {bad.length === 0 ? (
              <span className='inline-flex items-center gap-1.5 font-medium text-ok-foreground'>
                <CircleCheck className='size-4' /> Все регулярные копии свежие
              </span>
            ) : (
              <span className='inline-flex items-center gap-1.5 font-medium text-danger-foreground'>
                <CircleAlert className='size-4' /> Устарели: {bad.map((b) => b.title).join(', ')}
              </span>
            )}
            <span className='inline-flex items-center gap-1.5 text-muted-foreground'>
              <HardDrive className='size-4' /> Отдельного диска под бэкапы нет: всё лежит на системном SSD
            </span>
          </div>
          <div className='grid gap-4 lg:grid-cols-2'>
            {data.map((b) => (
              <BackupCard key={b.id} b={b} />
            ))}
          </div>
          <p className='mt-4 text-xs text-muted-foreground'>
            Устаревшие копии уведомляют в Telegram один раз (проверка раз в час). Разовые копии «перед обновлением» по расписанию не обновляются, панель их не удаляет — чистить нужно вручную.
          </p>
        </>
      )}
    </Page>
  )
}
