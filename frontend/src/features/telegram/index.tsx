import { lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ExternalLink, ScrollText, Send } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { AlertAnalytics, BotInfo, FileInfo, LeadAnalytics } from '@/lib/types'
import { Page } from '@/components/layout/page'
import { NoData } from '@/components/no-data'
import { ServiceIcon } from '@/components/service-icon'
import { StatusBadge, unitStatus } from '@/components/status-badge'
import { UnitControls } from '@/components/unit-controls'
import { Value } from '@/components/value'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// recharts — отдельным чанком
const DayBars = lazy(() => import('./day-bars').then((m) => ({ default: m.DayBars })))
const Bars = (p: React.ComponentProps<typeof DayBars>) => (
  <Suspense fallback={<div className='h-36' />}>
    <DayBars {...p} />
  </Suspense>
)

const CONTACT: Record<string, string> = { telegram: 'Telegram', phone: 'телефон', email: 'email', other: 'другое' }

function PathRow({ label, f }: { label: string; f: FileInfo }) {
  if (!f) return null
  return (
    <>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='min-w-0'>
        <Value kind='address' value={f.path} className='break-all' />
        <span className='ms-2 text-xs text-muted-foreground'>
          {f.missing ? 'нет файла' : !f.access ? 'нет доступа' : f.mtime ? <>изменён <Value kind='ago' value={f.mtime} /></> : null}
        </span>
      </dd>
    </>
  )
}

function AlertBlock({ a }: { a: AlertAnalytics }) {
  const total = a.alertsPerDay.reduce((x, d) => x + d.count, 0)
  return (
    <div className='space-y-4'>
      <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'>
        <dt className='text-muted-foreground'>Подписчиков</dt>
        <dd>
          <Value kind='count' value={a.subscribers} />
        </dd>
        <dt className='text-muted-foreground'>Доставка за сутки</dt>
        <dd>
          {a.delivery ? (
            <StatusBadge
              status={a.delivery.avgSec <= 15 ? 'ok' : a.delivery.avgSec <= 60 ? 'warning' : 'error'}
              label={`в среднем ${a.delivery.avgSec} с, макс. ${a.delivery.maxSec} с (${a.delivery.messages} сообщ.)`}
            />
          ) : (
            <NoData />
          )}
        </dd>
      </dl>
      <div>
        <div className='mb-1 text-sm font-medium'>
          Тревоги по дням (30 дней): <Value kind='count' value={total} />
        </div>
        <Bars data={a.alertsPerDay} label='тревог' color='var(--info)' />
      </div>
      <div>
        <div className='mb-1 text-sm font-medium'>Последние 10 тревог</div>
        <ul className='space-y-1 text-sm'>
          {a.lastAlerts.map((x, i) => (
            <li key={i} className='flex gap-2'>
              <span className='shrink-0 text-xs text-time tabular-nums'>{formatDateTime(x.ts)}</span>
              <span className='min-w-0'>
                {x.text} <span className='text-xs text-muted-foreground'>({x.reason})</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <details className='text-sm'>
        <summary className='cursor-pointer font-medium'>Ключевые слова и регионы из конфига</summary>
        <div className='mt-2 space-y-2'>
          {a.keywords.map((k) => (
            <div key={k.key}>
              <div className='text-xs text-muted-foreground'>{k.title}</div>
              <div className='flex flex-wrap gap-1'>
                {k.words.map((w) => (
                  <Badge key={w} variant='secondary' className='font-normal'>
                    {w}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}

function LeadBlock({ a }: { a: LeadAnalytics }) {
  const total = a.leadsPerDay.reduce((x, d) => x + d.count, 0)
  return (
    <div className='space-y-4'>
      <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'>
        <dt className='text-muted-foreground'>Заявок за 30 дней</dt>
        <dd>{a.loggingEnabled ? <Value kind='count' value={total} /> : <NoData reason='pulsdev-api пока не пишет заявки в журнал' />}</dd>
        <dt className='text-muted-foreground'>Отклонено (без имени/контакта)</dt>
        <dd>
          <Value kind='count' value={a.rejected30d} />
        </dd>
        <dt className='text-muted-foreground'>Новых пользователей бота</dt>
        <dd>
          <Value kind='count' value={a.greeted30d} />
        </dd>
        <dt className='text-muted-foreground'>Ошибки опроса за сутки</dt>
        <dd>
          <StatusBadge status={a.pollErrors24h === 0 ? 'ok' : a.pollErrors24h < 50 ? 'warning' : 'error'} label={String(a.pollErrors24h)} />
        </dd>
      </dl>
      {a.loggingEnabled ? (
        <>
          <div>
            <div className='mb-1 text-sm font-medium'>Заявки по дням (30 дней)</div>
            <Bars data={a.leadsPerDay} label='заявок' color='var(--ok)' />
          </div>
          <div>
            <div className='mb-1 text-sm font-medium'>Последние заявки</div>
            <ul className='space-y-1 text-sm'>
              {a.lastLeads.map((l, i) => (
                <li key={i} className='flex flex-wrap items-center gap-2'>
                  <span className='text-xs text-time tabular-nums'>{formatDateTime(l.ts)}</span>
                  <StatusBadge status={l.ok ? 'ok' : 'error'} label={l.ok ? 'доставлена' : 'не доставлена'} />
                  <span className='text-muted-foreground'>
                    контакт: {CONTACT[l.contact ?? 'other'] ?? l.contact}, задача: {l.task ? 'есть' : 'нет'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <p className='text-xs text-muted-foreground'>
          Статистика заявок появится после правки pulsdev-api: одна строка лога на заявку (без имени, контакта и текста).
        </p>
      )}
    </div>
  )
}

function BotCard({ b }: { b: BotInfo }) {
  const svc = b.service.data
  const tg = b.telegram.data
  return (
    <Card className='gap-3'>
      <CardHeader className='flex flex-row items-start gap-3'>
        <ServiceIcon slug='telegram' className='size-10 shrink-0' />
        <div className='min-w-0 flex-1'>
          <CardTitle className='text-base'>{b.title}</CardTitle>
          <p className='text-xs text-muted-foreground'>{b.description}</p>
        </div>
        {svc ? <StatusBadge status={unitStatus(svc.active)} label={svc.active === 'active' ? 'работает' : svc.active} /> : <NoData />}
      </CardHeader>
      <CardContent className='space-y-4 text-sm'>
        <div className='flex flex-wrap gap-2'>
          {tg?.username ? (
            <Button size='sm' asChild>
              <a href={`https://t.me/${tg.username}`} target='_blank' rel='noreferrer'>
                <Send /> @{tg.username}
              </a>
            </Button>
          ) : (
            <span className='text-xs text-muted-foreground'>
              Бот в Telegram: <NoData reason={tg?.error ?? b.telegram.error ?? undefined} />
            </span>
          )}
          {b.links.map((l) => (
            <Button key={l.url} size='sm' variant='outline' asChild>
              <a href={l.url} target='_blank' rel='noreferrer'>
                <ExternalLink /> {l.title}
              </a>
            </Button>
          ))}
        </div>

        <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'>
          <dt className='text-muted-foreground'>Служба</dt>
          <dd>
            <Value kind='address' value={b.unit} />
            {svc?.since && (
              <>
                {' '}
                · в сети <Value kind='duration' value={Math.round((Date.now() - svc.since) / 1000)} />
              </>
            )}
            {svc && (
              <>
                {' '}
                · перезапусков <Value kind='count' value={svc.restarts} />
              </>
            )}
            {svc?.memory != null && (
              <>
                {' '}
                · <Value kind='bytes' value={svc.memory} />
              </>
            )}
          </dd>
          <dt className='text-muted-foreground'>Среда</dt>
          <dd>{b.runtime.data ? <span className='text-info'>{b.runtime.data}</span> : <NoData reason={b.runtime.error} />}</dd>
          <PathRow label='Папка' f={b.paths.dir} />
          <PathRow label='Запуск' f={b.paths.entry} />
          <PathRow label='Конфиг' f={b.paths.config} />
          <PathRow label='Лог' f={b.paths.log} />
        </dl>

        {b.analytics.error ? (
          <NoData reason={b.analytics.error} />
        ) : b.kind === 'alert-monitor' && b.analytics.data ? (
          <AlertBlock a={b.analytics.data as AlertAnalytics} />
        ) : b.kind === 'lead-api' && b.analytics.data ? (
          <LeadBlock a={b.analytics.data as LeadAnalytics} />
        ) : null}

        {b.problems.data && b.problems.data.length > 0 && (
          <details className='text-xs'>
            <summary className='cursor-pointer text-warn-foreground'>Ошибки и предупреждения в логе: {b.problems.data.length}</summary>
            <pre className='mt-1 max-h-48 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap'>
              {b.problems.data.map((p) => `${formatDateTime(p.ts)}  ${p.text}`).join('\n')}
            </pre>
          </details>
        )}

        <div className='flex flex-wrap gap-2'>
          <UnitControls unit={b.unit} title={b.title} active={svc?.active === 'active'} invalidate={['bots']} />
          {b.logSource && (
            <Button size='sm' variant='ghost' asChild>
              <Link to='/system' search={{ tab: 'logs', source: b.logSource }}>
                <ScrollText /> Полный лог
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function Telegram() {
  const { data, isError } = useQuery({
    queryKey: ['bots'],
    queryFn: async () => (await api.get<BotInfo[]>('/bots')).data,
    refetchInterval: 30_000,
  })
  return (
    <Page title='Telegram-боты' description='Боты из реестра backend/bots.json — добавить бота = добавить запись'>
      {isError && <NoData reason='не удалось получить список ботов' />}
      <div className='grid items-start gap-4 xl:grid-cols-2'>
        {data?.map((b) => (
          <BotCard key={b.id} b={b} />
        ))}
      </div>
    </Page>
  )
}
