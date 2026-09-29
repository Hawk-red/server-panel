import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronLeft, ChevronRight, CloudUpload, GitCommitHorizontal, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { NoData } from '@/components/no-data'
import { StatusBadge, type Status } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

type Commit = { hash: string; ts: number; author: string; subject: string; body: string; pushed: boolean }
type CommitFile = { status: string; path: string; from: string | null; added: number | null; deleted: number | null }
type BackupStatus = {
  remote: string | null
  unpushed: number | null
  lastPushTs: number | null
  uncommitted: number | null
  auto: { ts: number; result: 'pushed' | 'nothing' | 'error'; count: number; message: string } | null
}

const PAGE = 30
const FILE_STATUS: Record<string, string> = { A: 'добавлен', M: 'изменён', D: 'удалён', R: 'переименован', C: 'скопирован', T: 'тип изменён' }
const fmt = (ts: number) => new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

function ago(ts: number) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60_000))
  if (m < 1) return 'только что'
  if (m < 60) return `${m} мин назад`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} ч назад` : `${Math.round(h / 24)} дн назад`
}

function BackupCard() {
  const { data: s, isError } = useQuery({
    queryKey: ['panel-backup-status'],
    queryFn: async () => (await api.get<BackupStatus>('/panel-changes/backup-status')).data,
    refetchInterval: 30_000,
  })
  if (isError) return <NoData reason='не удалось прочитать состояние репозитория' />
  if (!s) return <Loader2 className='size-4 animate-spin' />

  // Кроме ошибки последнего автозапуска, тревожит и то, что неотправленное висит дольше ~2 часов
  const stale = s.lastPushTs !== null && (s.unpushed ?? 0) > 0 && Date.now() - s.lastPushTs > 2 * 3_600_000
  const status: Status = s.auto?.result === 'error' ? 'error' : stale ? 'warning' : s.unpushed === null ? 'unknown' : 'ok'
  const label =
    s.auto?.result === 'error' ? 'последний push не удался' : s.unpushed === null ? 'нет данных' : s.unpushed === 0 ? 'всё отправлено' : `не отправлено: ${s.unpushed}`

  return (
    <Card className='mb-4 gap-2 py-4'>
      <CardContent className='space-y-3 px-4'>
        <div className='flex flex-wrap items-center gap-x-4 gap-y-1'>
          <CloudUpload className='size-4 text-muted-foreground' aria-hidden />
          <span className='text-sm font-medium'>Резервная копия на GitHub</span>
          <StatusBadge status={status} label={label} className='text-xs' />
        </div>
        <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm'>
          <dt className='text-muted-foreground'>Последний push</dt>
          <dd className='text-time'>{s.lastPushTs ? `${fmt(s.lastPushTs)} · ${ago(s.lastPushTs)}` : 'ещё не было'}</dd>
          <dt className='text-muted-foreground'>Не отправлено коммитов</dt>
          <dd className='tabular-nums'>{s.unpushed ?? '—'}</dd>
          {s.uncommitted ? (
            <>
              <dt className='text-muted-foreground'>Не закоммичено</dt>
              <dd className='tabular-nums'>{s.uncommitted} файл(ов) — в копию попадёт только после коммита</dd>
            </>
          ) : null}
          <dt className='text-muted-foreground'>Автоотправка</dt>
          <dd>
            раз в час (:17)
            {s.auto && (
              <span className='text-muted-foreground'>
                {' '}
                · проверка {ago(s.auto.ts)}
                {s.auto.result === 'pushed' ? `, отправлено ${s.auto.count}` : s.auto.result === 'nothing' ? ', нового не было' : ''}
              </span>
            )}
          </dd>
          {s.remote && (
            <>
              <dt className='text-muted-foreground'>Репозиторий</dt>
              <dd className='font-mono text-address'>{s.remote}</dd>
            </>
          )}
        </dl>
        {s.auto?.result === 'error' && <p className='rounded bg-muted p-2 font-mono text-xs break-words'>{s.auto.message}</p>}
      </CardContent>
    </Card>
  )
}

function Files({ hash }: { hash: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['panel-commit', hash],
    queryFn: async () => (await api.get<{ files: CommitFile[] }>(`/panel-changes/${hash}`)).data.files,
    staleTime: Infinity,
  })
  if (isPending) return <Loader2 className='size-4 animate-spin' />
  if (isError) return <span className='text-xs text-muted-foreground'>Не удалось получить список файлов.</span>
  if (data.length === 0) return <span className='text-xs text-muted-foreground'>Файлов нет (пустой коммит или слияние).</span>
  return (
    <ul className='space-y-1'>
      {data.map((f) => (
        <li key={f.path} className='flex items-baseline gap-2 text-xs'>
          <span className='w-24 shrink-0 text-muted-foreground'>{FILE_STATUS[f.status] ?? f.status}</span>
          <span className='min-w-0 flex-1 font-mono break-all'>
            {f.from ? `${f.from} → ` : ''}
            {f.path}
          </span>
          <span className='shrink-0 tabular-nums'>
            {f.added === null ? (
              <span className='text-muted-foreground'>бинарный</span>
            ) : (
              <>
                <span className='text-ok-foreground'>+{f.added}</span> <span className='text-danger-foreground'>−{f.deleted}</span>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function PanelChanges() {
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const { data, isError } = useQuery({
    queryKey: ['panel-changes', page],
    queryFn: async () => (await api.get<{ total: number; rows: Commit[] }>('/panel-changes', { params: { limit: PAGE, offset: page * PAGE } })).data,
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  })
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE))

  return (
    <>
      <BackupCard />
      <Card className='py-0'>
        <CardContent className='divide-y p-0'>
          {isError && (
            <div className='p-4'>
              <NoData reason='не удалось загрузить историю коммитов' />
            </div>
          )}
          {data?.rows.length === 0 && <p className='p-4 text-center text-sm text-muted-foreground'>Коммитов нет</p>}
          {data?.rows.map((c) => {
            const isOpen = open === c.hash
            return (
              <div key={c.hash}>
                <button
                  type='button'
                  onClick={() => setOpen(isOpen ? null : c.hash)}
                  aria-expanded={isOpen}
                  className='flex w-full items-start gap-3 px-4 py-2.5 text-start text-sm hover:bg-muted/50 focus-visible:bg-muted/50'
                >
                  <GitCommitHorizontal className='mt-0.5 size-4 shrink-0 text-info' aria-hidden />
                  <div className='min-w-0 flex-1'>
                    <div className='font-medium break-words'>{c.subject}</div>
                    <div className='text-xs text-muted-foreground'>
                      {c.author} · <span className='font-mono text-address'>{c.hash.slice(0, 7)}</span>
                    </div>
                  </div>
                  <div className='flex shrink-0 flex-col items-end gap-0.5'>
                    <StatusBadge status={c.pushed ? 'ok' : 'warning'} label={c.pushed ? 'на GitHub' : 'не отправлен'} className='text-xs' />
                    <span className='text-xs text-time tabular-nums'>{fmt(c.ts)}</span>
                  </div>
                  <ChevronDown className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                </button>
                {isOpen && (
                  <div className='space-y-2 border-t bg-muted/30 px-4 py-3'>
                    {c.body && <p className='text-sm whitespace-pre-wrap text-muted-foreground'>{c.body}</p>}
                    <Files hash={c.hash} />
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>
      <div className='mt-3 flex items-center justify-between text-sm text-muted-foreground'>
        <span>Коммитов: {data?.total ?? '…'}</span>
        <div className='flex items-center gap-2'>
          <Button size='icon' variant='outline' disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label='Назад'>
            <ChevronLeft />
          </Button>
          <span className='tabular-nums'>
            {page + 1} / {pages}
          </span>
          <Button size='icon' variant='outline' disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} aria-label='Вперёд'>
            <ChevronRight />
          </Button>
        </div>
      </div>
    </>
  )
}
