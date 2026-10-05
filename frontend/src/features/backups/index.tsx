import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { CircleAlert, CircleCheck, CircleHelp, Clock, Database, HardDrive, RefreshCw, Smartphone, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatDateTime, formatRelative } from '@/lib/format'
import type { BackupItem } from '@/features/infra-types'
import { Page } from '@/components/layout/page'
import { type Block, blockId, SortableBlocks } from '@/components/sortable-blocks'
import { NoData } from '@/components/no-data'
import { Value } from '@/components/value'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { StatusBadge } from '@/components/status-badge'

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

type IpadJob = {
  status: 'idle' | 'running' | 'ok' | 'retry' | 'error'
  startedAt: number | null
  finishedAt: number | null
  exitCode: number | null
  message: string
  tail: string[]
}

// Запуск бэкапа iPad по кнопке: скрипт на MacBook по SSH. Статус опрашивается, пока идёт бэкап.
// «Повторим позже» (iPad спит / не в Wi-Fi) — не ошибка, показываем нейтрально.
function IpadRunner() {
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const job = useQuery({
    queryKey: ['ipad-job'],
    queryFn: async () => (await api.get<IpadJob>('/backups/ipad/job')).data,
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 3000 : false),
  })
  const j = job.data
  const running = j?.status === 'running'
  // Пока идёт бэкап — показываем «прошло N мин»; тикаем раз в секунду
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])
  // Когда бэкап закончился — обновляем карточку бэкапов (новая дата последней копии)
  const wasRunning = useRef(false)
  useEffect(() => {
    if (running) wasRunning.current = true
    else if (wasRunning.current) {
      wasRunning.current = false
      qc.invalidateQueries({ queryKey: ['backups'] })
    }
  }, [running, qc])

  const start = useMutation({
    mutationFn: async () => (await api.post<IpadJob>('/backups/ipad/run', {})).data,
    onSuccess: () => {
      setConfirm(false)
      qc.invalidateQueries({ queryKey: ['ipad-job'] })
    },
    onError: (e) => {
      setConfirm(false)
      const msg = (e instanceof AxiosError && e.response?.data?.message) || 'не удалось запустить'
      toast.error(msg)
    },
  })

  const elapsedMin = j?.startedAt ? Math.max(0, Math.floor((now - j.startedAt) / 60_000)) : 0
  return (
    <div className='space-y-2 border-t pt-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='text-sm font-medium'>Запуск</div>
        <Button size='sm' variant='outline' disabled={running || start.isPending} onClick={() => setConfirm(true)}>
          <Smartphone /> Запустить бэкап iPad
        </Button>
      </div>
      {j && (
        <div className='space-y-1 text-sm'>
          {j.status === 'idle' && <span className='text-muted-foreground'>{j.message}</span>}
          {j.status === 'running' && (
            <div className='flex items-center gap-2'>
              <RefreshCw className='size-4 animate-spin text-info' aria-hidden='true' />
              <span>
                Бэкап идёт{elapsedMin > 0 ? `: ${elapsedMin} мин` : ''}
              </span>
            </div>
          )}
          {j.status === 'ok' && <StatusBadge status='ok' label='готово' />}
          {j.status === 'retry' && (
            <div className='flex items-start gap-2 text-muted-foreground'>
              <Clock className='mt-0.5 size-4 shrink-0' aria-hidden='true' />
              <span className='font-medium text-foreground'>Ждёт iPad — повторит позже</span>
            </div>
          )}
          {j.status === 'error' && <StatusBadge status='error' label={j.exitCode != null ? `сбой (код ${j.exitCode})` : 'сбой'} />}
          {j.status !== 'idle' && j.status !== 'running' && j.message && <p className='text-xs text-muted-foreground'>{j.message}</p>}
          {j.status === 'running' && <p className='text-xs text-muted-foreground'>{j.message}</p>}
          {j.finishedAt && j.status !== 'running' && <p className='text-xs text-muted-foreground'>завершён {formatDateTime(j.finishedAt)}</p>}
          {j.status === 'error' && j.tail.length > 0 && (
            <details className='text-xs'>
              <summary className='cursor-pointer text-muted-foreground'>Вывод ssh</summary>
              <pre className='mt-1 max-h-40 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap'>{j.tail.join('\n')}</pre>
            </details>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={(o) => !o && !start.isPending && setConfirm(false)}
        title='Запустить бэкап iPad?'
        desc='Скрипт на MacBook запустится сейчас и сделает копию, даже если сегодня она уже была. iPad должен быть в Wi-Fi и разблокирован; если попросит код, введите его на iPad. Бэкап может идти до 2 часов.'
        confirmText='Запустить'
        isLoading={start.isPending}
        handleConfirm={() => start.mutate()}
      />
    </div>
  )
}

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
        {b.id === 'ipad' && <IpadRunner />}
      </CardContent>
    </Card>
  )
}

export function Backups() {
  const { data, isError } = useQuery({ queryKey: ['backups'], queryFn: async () => (await api.get<{ items: BackupItem[] }>('/backups')).data.items, refetchInterval: 30_000 })
  const bad = data?.filter((b) => b.type === 'scheduled' && (b.status === 'stale' || b.status === 'missing')) ?? []
  return (
    <Page title='Бэкапы' description='Свежесть и размер резервных копий на сервере' layoutPage='backups'>
      {isError ? (
        <NoData reason='бэкенд не ответил' />
      ) : !data ? (
        <span className='text-sm text-muted-foreground'>Загрузка…</span>
      ) : (
        <SortableBlocks
          grid
          className='grid gap-4 lg:grid-cols-2'
          blocks={[
            {
              id: 'summary',
              title: 'Итог по копиям',
              className: 'lg:col-span-2',
              node: (
          <div className='flex flex-wrap items-center gap-x-4 gap-y-1 text-sm'>
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
              ),
            },
            ...data.map((b): Block => ({ id: blockId('b', b.id), title: b.title, node: <BackupCard b={b} /> })),
            {
              id: 'note',
              title: 'Пояснение',
              className: 'lg:col-span-2',
              node: (
          <p className='text-xs text-muted-foreground'>
            Устаревшие копии уведомляют в Telegram один раз (проверка раз в час). Разовые копии «перед обновлением» по расписанию не обновляются, панель их не удаляет — чистить нужно вручную.
          </p>
              ),
            },
          ]}
        />
      )}
    </Page>
  )
}
