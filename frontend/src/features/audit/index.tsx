import { lazy, Suspense, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Loader2, Server, UserRound } from 'lucide-react'
import { api } from '@/lib/api'
import type { AuditSummary, FeedRow } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Page } from '@/components/layout/page'
import { NoData } from '@/components/no-data'
import { StatusBadge } from '@/components/status-badge'
import { Value } from '@/components/value'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { describeDetails, feedLink, kindLabel, LEVEL } from './feed-meta'

const DayChart = lazy(() => import('./day-chart').then((m) => ({ default: m.DayChart })))
const PERIODS: Record<string, number> = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 }
const PAGE = 50

function Context({ r }: { r: FeedRow }) {
  const { data, isPending } = useQuery({
    queryKey: ['audit-context', r.type, r.id],
    queryFn: async () =>
      (await api.get<{ source: string | null; lines: { ts: number | null; text: string }[] }>('/audit/context', { params: { type: r.type, id: r.id } })).data,
    staleTime: 60_000,
  })
  const link = feedLink(r)
  return (
    <div className='space-y-2 border-t bg-muted/30 px-4 py-3 text-sm'>
      <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'>
        <dt className='text-muted-foreground'>Когда</dt>
        <dd className='text-time'>{new Date(r.ts).toLocaleString('ru-RU')}</dd>
        {r.target && (
          <>
            <dt className='text-muted-foreground'>Объект</dt>
            <dd>
              <Value kind='address' value={r.target} />
            </dd>
          </>
        )}
        {r.ip && (
          <>
            <dt className='text-muted-foreground'>С какого IP</dt>
            <dd>
              <Value kind='address' value={r.ip} />
            </dd>
          </>
        )}
        {r.details != null && (
          <>
            <dt className='text-muted-foreground'>Подробности</dt>
            <dd className='break-words'>{describeDetails(r.details)}</dd>
          </>
        )}
      </dl>
      {link && (
        <Button size='sm' variant='outline' asChild>
          <Link to={link.to} search={link.search}>
            <ArrowRight /> {link.label}
          </Link>
        </Button>
      )}
      <div>
        <div className='mb-1 text-xs text-muted-foreground'>
          Лог вокруг момента (±3 мин){data?.source ? <> · <span className='font-mono text-address'>{data.source}</span></> : ''}
        </div>
        {isPending ? (
          <Loader2 className='size-4 animate-spin' />
        ) : !data?.source ? (
          <span className='text-xs text-muted-foreground'>Для этой записи связанного лога нет.</span>
        ) : data.lines.length === 0 ? (
          <span className='text-xs text-muted-foreground'>В этом окне строк нет.</span>
        ) : (
          <pre className='max-h-56 overflow-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap'>
            {data.lines.map((l) => `${l.ts ? new Date(l.ts).toLocaleTimeString('ru-RU') + '  ' : ''}${l.text}`).join('\n')}
          </pre>
        )}
      </div>
    </div>
  )
}

export function Audit() {
  const [type, setType] = useState('all')
  const [kind, setKind] = useState('all')
  const [level, setLevel] = useState('all')
  const [period, setPeriod] = useState('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const reset = () => setPage(0)

  const summary = useQuery({ queryKey: ['audit-summary'], queryFn: async () => (await api.get<AuditSummary>('/audit/summary')).data, refetchInterval: 60_000 })
  const facets = useQuery({
    queryKey: ['audit-facets'],
    queryFn: async () => (await api.get<{ kinds: { type: string; kind: string; n: number }[] }>('/audit/facets')).data,
  })
  const { data, isError } = useQuery({
    queryKey: ['audit', type, kind, level, period, q, page],
    queryFn: async () =>
      (
        await api.get<{ total: number; rows: FeedRow[] }>('/audit', {
          params: {
            limit: PAGE,
            offset: page * PAGE,
            type: type === 'all' ? undefined : type,
            kind: kind === 'all' ? undefined : kind,
            level: level === 'all' ? undefined : level,
            from: period === 'all' ? undefined : Date.now() - PERIODS[period],
            q: q || undefined,
          },
        })
      ).data,
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  })
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE))
  const s = summary.data

  return (
    <Page title='Журнал действий' description='Действия в панели и события сервера (хранятся год)'>
      <div className='grid gap-4 lg:grid-cols-3'>
        <Card className='gap-2 py-4 lg:col-span-1'>
          <CardContent className='grid grid-cols-3 gap-3 px-4 text-sm lg:grid-cols-1'>
            <div>
              <div className='text-xs text-muted-foreground'>Действий панели</div>
              <Value kind='count' value={s?.actions.day} className='text-xl' /> <span className='text-xs text-muted-foreground'>за сутки</span>
              <div className='text-xs text-muted-foreground'>
                <Value kind='count' value={s?.actions.week} /> за неделю
              </div>
            </div>
            <div>
              <div className='text-xs text-muted-foreground'>Системных событий</div>
              <Value kind='count' value={s?.events.day} className='text-xl' /> <span className='text-xs text-muted-foreground'>за сутки</span>
              <div className='text-xs text-muted-foreground'>
                <Value kind='count' value={s?.events.week} /> за неделю
              </div>
            </div>
            <div>
              <div className='text-xs text-muted-foreground'>Проблем (ошибки, отказы, предупреждения)</div>
              <Value kind='count' value={s?.problems.day} className={cn('text-xl', s?.problems.day ? 'text-warn-foreground' : undefined)} />{' '}
              <span className='text-xs text-muted-foreground'>за сутки</span>
              <div className='text-xs text-muted-foreground'>
                <Value kind='count' value={s?.problems.week} /> за неделю
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className='gap-1 py-3 lg:col-span-2'>
          <CardHeader className='px-4'>
            <CardTitle className='text-sm font-medium'>По дням, 30 дней</CardTitle>
          </CardHeader>
          <CardContent className='px-2'>
            <Suspense fallback={<div className='h-40' />}>{s && <DayChart perDay={s.perDay} />}</Suspense>
          </CardContent>
        </Card>
      </div>

      <div className='my-4 flex flex-wrap gap-2'>
        <Select value={type} onValueChange={(v) => (setType(v), setKind('all'), reset())}>
          <SelectTrigger className='w-48'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>Всё</SelectItem>
            <SelectItem value='user'>Действия в панели</SelectItem>
            <SelectItem value='system'>Системные события</SelectItem>
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={(v) => (setKind(v), reset())}>
          <SelectTrigger className='w-56'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>Любое действие / событие</SelectItem>
            {facets.data?.kinds
              .filter((k) => type === 'all' || k.type === type)
              .map((k) => (
                <SelectItem key={`${k.type}-${k.kind}`} value={k.kind}>
                  {kindLabel(k.kind)} ({k.n})
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select value={level} onValueChange={(v) => (setLevel(v), reset())}>
          <SelectTrigger className='w-40'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>Любой результат</SelectItem>
            <SelectItem value='problems'>Только проблемы</SelectItem>
            <SelectItem value='ok'>успешно</SelectItem>
            <SelectItem value='error'>ошибка</SelectItem>
            <SelectItem value='denied'>отказано</SelectItem>
          </SelectContent>
        </Select>
        <Select value={period} onValueChange={(v) => (setPeriod(v), reset())}>
          <SelectTrigger className='w-36'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>За всё время</SelectItem>
            <SelectItem value='day'>Сутки</SelectItem>
            <SelectItem value='week'>Неделя</SelectItem>
            <SelectItem value='month'>Месяц</SelectItem>
          </SelectContent>
        </Select>
        <Input className='max-w-xs' placeholder='Поиск: объект, IP, текст' value={q} onChange={(e) => (setQ(e.target.value), reset())} />
      </div>

      <Card className='py-0'>
        <CardContent className='divide-y p-0'>
          {isError && (
            <div className='p-4'>
              <NoData reason='не удалось загрузить журнал' />
            </div>
          )}
          {data?.rows.length === 0 && <p className='p-4 text-center text-sm text-muted-foreground'>Записей нет</p>}
          {data?.rows.map((r) => {
            const key = `${r.type}-${r.id}`
            const open = openKey === key
            const lvl = LEVEL[r.level] ?? LEVEL.info
            return (
              <div key={key}>
                <button
                  type='button'
                  onClick={() => setOpenKey(open ? null : key)}
                  aria-expanded={open}
                  className='flex w-full items-start gap-3 px-4 py-2.5 text-start text-sm hover:bg-muted/50 focus-visible:bg-muted/50'
                >
                  {r.type === 'user' ? (
                    <UserRound className='mt-0.5 size-4 shrink-0 text-info' aria-label='действие в панели' />
                  ) : (
                    <Server className='mt-0.5 size-4 shrink-0 text-ok-foreground' aria-label='системное событие' />
                  )}
                  <div className='min-w-0 flex-1'>
                    <div className='font-medium'>{r.type === 'user' ? kindLabel(r.kind) : (r.text ?? kindLabel(r.kind))}</div>
                    <div className='text-xs text-muted-foreground'>
                      {r.type === 'user' ? 'действие в панели' : `событие сервера · ${kindLabel(r.kind)}`}
                      {r.target && r.type === 'user' ? <> · <span className='font-mono text-address'>{r.target}</span></> : ''}
                      {r.ip ? <> · <span className='font-mono text-address'>{r.ip}</span></> : ''}
                    </div>
                  </div>
                  <div className='flex shrink-0 flex-col items-end gap-0.5'>
                    <StatusBadge status={lvl.status} label={lvl.text} className='text-xs' />
                    <span className='text-xs text-time tabular-nums'>
                      {new Date(r.ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <ChevronDown className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
                </button>
                {open && <Context r={r} />}
              </div>
            )
          })}
        </CardContent>
      </Card>

      <div className='mt-3 flex items-center justify-between text-sm text-muted-foreground'>
        <span>Всего: {data?.total ?? '…'}</span>
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
    </Page>
  )
}
