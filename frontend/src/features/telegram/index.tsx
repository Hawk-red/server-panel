import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ScrollText } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDateTime, formatDuration, formatRelative } from '@/lib/format'
import type { TelegramData } from '@/lib/types'
import { Page } from '@/components/layout/page'
import { NoData } from '@/components/no-data'
import { ServiceIcon } from '@/components/service-icon'
import { StatusBadge, unitStatus } from '@/components/status-badge'
import { UnitControls } from '@/components/unit-controls'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function Telegram() {
  const { data } = useQuery({
    queryKey: ['telegram'],
    queryFn: async () => (await api.get<TelegramData>('/telegram')).data,
    refetchInterval: 15_000,
  })
  const am = data?.alertMonitor.data
  const lead = data?.leadBot.data
  const u = (name: string) => data?.units.data?.find((x) => x.unit === name) ?? null
  const amUnit = u('alert_monitor.service')
  const pUnit = u('pulsdev-api.service')

  return (
    <Page title='Telegram-боты' description='На сервере два бота: оповещение о тревогах и приём заявок pulsdev.net'>
      <div className='grid gap-4 lg:grid-cols-2'>
        <Card className='gap-3'>
          <CardHeader className='flex flex-row items-start gap-3'>
            <ServiceIcon slug='telegram' className='size-10 shrink-0' />
            <div className='min-w-0 flex-1'>
              <CardTitle className='text-base'>Air Alert Monitor {am?.bot && <span className='font-normal text-muted-foreground'>{am.bot}</span>}</CardTitle>
              <p className='text-xs text-muted-foreground'>Python + Telethon · /opt/alert_monitor · systemd alert_monitor</p>
            </div>
            {amUnit ? <StatusBadge status={unitStatus(amUnit.active)} label={amUnit.active === 'active' ? 'работает' : amUnit.active} /> : <NoData />}
          </CardHeader>
          <CardContent className='space-y-3 text-sm'>
            <p className='text-muted-foreground'>
              Читает канал Воздушных сил {am?.channel ?? '@kpszsu'} (опрос каждые 7 с), фильтрует угрозы для Киева и области и рассылает предупреждения подписчикам бота.
            </p>
            {data?.alertMonitor.error ? (
              <NoData reason={data.alertMonitor.error} />
            ) : (
              <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'>
                <dt className='text-muted-foreground'>В сети</dt>
                <dd>{amUnit?.since ? `${formatDuration(Math.round((Date.now() - amUnit.since) / 1000))} (с ${formatDateTime(amUnit.since)})` : '—'}</dd>
                <dt className='text-muted-foreground'>Подписчиков</dt>
                <dd>{am?.subscribers ?? '—'}</dd>
                <dt className='text-muted-foreground'>Доставка за сутки</dt>
                <dd>
                  {am?.delivery ? (
                    <StatusBadge
                      status={am.delivery.avgSec <= 15 ? 'ok' : am.delivery.avgSec <= 60 ? 'warning' : 'error'}
                      label={`в среднем ${am.delivery.avgSec} с, макс. ${am.delivery.maxSec} с (${am.delivery.messages} сообщ.)`}
                    />
                  ) : (
                    <NoData />
                  )}
                </dd>
                <dt className='text-muted-foreground'>Рассылок за сутки</dt>
                <dd>{am?.alertsToday ?? '—'}</dd>
                <dt className='text-muted-foreground'>Последнее из канала</dt>
                <dd>{am?.lastChannelMessage ? formatRelative(am.lastChannelMessage) : '—'}</dd>
                <dt className='text-muted-foreground'>Последняя тревога</dt>
                <dd>{am?.lastAlert ? `${formatDateTime(am.lastAlert.ts)} — ${am.lastAlert.text}` : '—'}</dd>
              </dl>
            )}
            {am && am.problems.length > 0 && (
              <details className='text-xs'>
                <summary className='cursor-pointer text-yellow-700 dark:text-yellow-400'>Ошибки и предупреждения в логе: {am.problems.length}</summary>
                <pre className='mt-1 max-h-48 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap'>
                  {am.problems.map((p) => `${formatDateTime(p.ts)}  ${p.text}`).join('\n')}
                </pre>
              </details>
            )}
            <p className='text-xs text-muted-foreground'>
              «Аномальная задержка 600–900 сек» в логе бота — не опоздание рассылки: это поздние события Telethon, те же сообщения уже доставлены опросом.
            </p>
            <div className='flex flex-wrap gap-2'>
              <UnitControls unit='alert_monitor.service' title='бот тревог' active={amUnit?.active === 'active'} invalidate={['telegram']} warning='Пока бот остановлен, подписчики не получат предупреждения о воздушной тревоге.' />
              <Button size='sm' variant='ghost' asChild>
                <Link to='/system' search={{ tab: 'logs', source: 'file:/opt/alert_monitor/alert_monitor.log' }}>
                  <ScrollText /> Лог бота
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className='gap-3'>
          <CardHeader className='flex flex-row items-start gap-3'>
            <ServiceIcon slug='telegram' className='size-10 shrink-0' />
            <div className='min-w-0 flex-1'>
              <CardTitle className='text-base'>Бот заявок pulsdev.net</CardTitle>
              <p className='text-xs text-muted-foreground'>Внутри pulsdev-api (/home/hawk/pulsdev-api/index.js): POST /lead → сообщение владельцу, getUpdates — приветствие</p>
            </div>
            {pUnit ? <StatusBadge status={unitStatus(pUnit.active)} label={pUnit.active === 'active' ? 'работает' : pUnit.active} /> : <NoData />}
          </CardHeader>
          <CardContent className='space-y-3 text-sm'>
            {data?.leadBot.error ? (
              <NoData reason={data.leadBot.error} />
            ) : (
              <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'>
                <dt className='text-muted-foreground'>Имя бота</dt>
                <dd>
                  <NoData reason='токен в закрытом .env pulsdev-api (600, hawk)' />
                </dd>
                <dt className='text-muted-foreground'>В сети</dt>
                <dd>{pUnit?.since ? formatDuration(Math.round((Date.now() - pUnit.since) / 1000)) : '—'}</dd>
                <dt className='text-muted-foreground'>Ошибки опроса за сутки</dt>
                <dd>
                  <StatusBadge
                    status={!lead ? 'unknown' : lead.pollErrors24h === 0 ? 'ok' : lead.pollErrors24h < 50 ? 'warning' : 'error'}
                    label={lead ? `${lead.pollErrors24h}${lead.lastPollError ? `, последняя ${formatRelative(lead.lastPollError.ts)}` : ''}` : '—'}
                  />
                </dd>
              </dl>
            )}
            {lead && lead.recent.length > 0 && (
              <pre className='max-h-40 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap'>
                {lead.recent.map((m) => `${formatDateTime(m.ts)}  ${m.text}`).join('\n')}
              </pre>
            )}
            <UnitControls unit='pulsdev-api.service' title='pulsdev-api' active={pUnit?.active === 'active'} invalidate={['telegram']} warning='Остановится весь pulsdev-api: и API для сайта, и бот заявок.' />
          </CardContent>
        </Card>
      </div>
    </Page>
  )
}
