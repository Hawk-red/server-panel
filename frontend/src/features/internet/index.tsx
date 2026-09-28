import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, Globe, RefreshCw, Timer, TriangleAlert, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatDateTime, formatDuration, formatRelative } from '@/lib/format'
import type { Range } from '@/lib/types'
import type { InternetStatus } from '@/features/infra-types'
import { Page } from '@/components/layout/page'
import { MetricChart, RANGE_LABELS } from '@/components/metric-chart'
import { NoData } from '@/components/no-data'
import { StatTile } from '@/components/stat-tile'
import { Value } from '@/components/value'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const ms = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} мс`
// Потери хранятся долей (0…1) — в графике показываем проценты
const lossPct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`

// Задержка: до 50 мс — норма, до 150 — заметно, выше — плохо (смысл дублируется подписью)
function pingLevel(v: number): { text: string; cls: string } {
  if (v <= 50) return { text: 'быстро', cls: 'text-ok-foreground' }
  if (v <= 150) return { text: 'заметно', cls: 'text-warn-foreground' }
  return { text: 'медленно', cls: 'text-danger-foreground' }
}

function outageText(sec: number) {
  return sec < 90 ? `${sec} с` : formatDuration(sec)
}

export function Internet() {
  const qc = useQueryClient()
  const [range, setRange] = useState<Range>('day')
  const { data, isError } = useQuery({ queryKey: ['internet'], queryFn: async () => (await api.get<InternetStatus>('/internet')).data, refetchInterval: 15_000 })
  const refreshIp = useMutation({
    mutationFn: () => api.post('/internet/refresh-ip', {}),
    onSuccess: () => {
      toast.success('Внешний IP обновлён')
      qc.invalidateQueries({ queryKey: ['internet'] })
    },
    onError: () => toast.error('Не удалось узнать внешний IP'),
  })

  const now = data?.now
  const down = data ? Boolean(data.downSince) : false
  const level = now?.main != null ? pingLevel(now.main) : null

  return (
    <Page title='Интернет' description='Доступность связи, задержка до 1.1.1.1 и внешний IP'>
      {isError ? (
        <NoData reason='бэкенд не ответил' />
      ) : (
        <>
          <div className='grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4'>
            <StatTile
              title='Связь'
              icon={down ? WifiOff : Globe}
              value={
                !data ? null : down ? (
                  <span className='inline-flex items-center gap-1.5 text-danger-foreground'>
                    <CircleAlert className='size-5' /> нет связи
                  </span>
                ) : now ? (
                  <span className='inline-flex items-center gap-1.5 text-ok-foreground'>
                    <CircleCheck className='size-5' /> есть
                  </span>
                ) : null
              }
              sub={
                down && data?.downSince ? (
                  <>
                    с {formatDateTime(data.downSince)} (<Value kind='ago' value={data.downSince} />)
                  </>
                ) : now?.second != null || now ? (
                  `проверено ${formatRelative(now?.ts)}`
                ) : (
                  'первый замер через 30 с'
                )
              }
              noDataReason={null}
            />
            <StatTile
              title={`Пинг до ${data?.targets.main ?? '1.1.1.1'}`}
              icon={Timer}
              value={now?.main != null ? <span className={level?.cls}>{ms(now.main)}</span> : now ? <span className='text-danger-foreground'>нет ответа</span> : null}
              sub={
                now ? (
                  <>
                    {level ? `${level.text} · ` : ''}
                    {data?.targets.second}: {now.second != null ? ms(now.second) : 'нет ответа'}
                  </>
                ) : undefined
              }
              noDataReason={null}
            />
            <StatTile
              title='Внешний IP'
              icon={Globe}
              value={data?.ip ? <Value kind='address' value={data.ip.ip} className='text-lg sm:text-xl' /> : null}
              sub={
                data?.ip ? (
                  <span className='flex flex-wrap items-center gap-x-2'>
                    <span>не менялся {formatRelative(data.ip.since).replace(' назад', '')}</span>
                    <button
                      type='button'
                      onClick={() => refreshIp.mutate()}
                      disabled={refreshIp.isPending}
                      className='inline-flex items-center gap-1 rounded text-info underline-offset-2 hover:underline focus-visible:underline'
                    >
                      <RefreshCw className={`size-3 ${refreshIp.isPending ? 'animate-spin' : ''}`} /> обновить
                    </button>
                  </span>
                ) : undefined
              }
              noDataReason={data ? 'IP ещё не определён (нужен доступ к api.ipify.org)' : null}
            />
            <StatTile
              title='Потери за 24 ч'
              icon={TriangleAlert}
              value={
                data?.day.lossPct != null ? (
                  <span className={data.day.lossPct >= 5 ? 'text-danger-foreground' : data.day.lossPct >= 1 ? 'text-warn-foreground' : 'text-ok-foreground'}>{data.day.lossPct}%</span>
                ) : null
              }
              sub={data?.day.avgMs != null ? `средний пинг ${ms(data.day.avgMs)}, максимум ${ms(data.day.maxMs ?? 0)}` : undefined}
              noDataReason={null}
            />
          </div>

          <div className='mt-4 flex flex-wrap items-center gap-2'>
            {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
              <Button key={r} size='sm' variant={r === range ? 'default' : 'outline'} onClick={() => setRange(r)}>
                {RANGE_LABELS[r]}
              </Button>
            ))}
          </div>
          <div className='mt-3 grid gap-3 lg:grid-cols-2'>
            <MetricChart title={`Пинг до ${data?.targets.main ?? '1.1.1.1'}, мс`} series={[{ name: 'inet.ping_ms', label: 'пинг', color: 'var(--info)' }]} range={range} format={ms} domain={[0, 'auto']} />
            {/* Вторая серия — другой цвет: потери показаны красным, чтобы не путать с пингом */}
            <MetricChart title='Потери пакетов' series={[{ name: 'inet.loss', label: 'потери', color: 'var(--danger)' }]} range={range} format={lossPct} domain={[0, 1]} />
          </div>

          <Card className='mt-4 gap-2'>
            <CardHeader>
              <CardTitle className='text-sm font-medium'>Обрывы связи</CardTitle>
            </CardHeader>
            <CardContent>
              {!data ? (
                <span className='text-sm text-muted-foreground'>Загрузка…</span>
              ) : data.outages.length === 0 ? (
                <span className='inline-flex items-center gap-1.5 text-sm text-ok-foreground'>
                  <CircleCheck className='size-4' /> Обрывов дольше минуты не было
                </span>
              ) : (
                <ul className='divide-y text-sm'>
                  {data.outages.slice(0, 15).map((o) => (
                    <li key={o.from} className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2'>
                      <span className='inline-flex items-center gap-1.5'>
                        {o.sec >= 300 ? <CircleAlert className='size-4 text-danger-foreground' /> : <TriangleAlert className='size-4 text-warn-foreground' />}
                        {formatDateTime(o.from)} — {new Date(o.to).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className={o.sec >= 300 ? 'font-medium text-danger-foreground' : 'text-muted-foreground'}>
                        {outageText(o.sec)}
                        {o.sec >= 300 && ' · с уведомлением'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className='mt-3 text-xs text-muted-foreground'>
                «Нет связи» — когда не отвечают оба адреса ({data?.targets.main} и {data?.targets.second}). Записываются обрывы дольше минуты; уведомление в Telegram — дольше 5 минут и приходит
                после восстановления связи (пока интернета нет, Telegram недоступен). За 7 суток: средний пинг {data?.week.avgMs != null ? ms(data.week.avgMs) : '—'}, потери{' '}
                {data?.week.lossPct != null ? `${data.week.lossPct}%` : '—'}.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </Page>
  )
}
