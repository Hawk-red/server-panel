import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { CircleAlert, Gauge, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatBytes, formatDateTime } from '@/lib/format'
import type { Range } from '@/lib/types'
import type { SpeedResult, SpeedtestState } from '@/features/infra-types'
import { MetricChart } from '@/components/metric-chart'
import { NoData } from '@/components/no-data'
import { Value } from '@/components/value'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

type SpeedMode = 'daily' | 'hourly' | 'every3h'
const MODES: { id: SpeedMode; label: string }[] = [
  { id: 'every3h', label: 'Раз в 3 часа' },
  { id: 'hourly', label: 'Раз в час' },
  { id: 'daily', label: 'Раз в сутки' },
]
const errMsg = (e: unknown) => (e instanceof AxiosError && e.response?.data?.message) || 'ошибка'
const mbps = (v: number | null) => (v == null ? '—' : `${v >= 100 ? Math.round(v) : v.toFixed(1)} Мбит/с`)

function Big({ label, flow, value }: { label: string; flow: 'rx' | 'tx'; value: number | null }) {
  return (
    <div>
      <div className='text-xs text-muted-foreground'>{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${flow === 'rx' ? 'text-rx' : 'text-tx'}`}>{mbps(value)}</div>
    </div>
  )
}

// Спидтест: загрузка/отдача/задержка до ближайшего узла Cloudflare. Приём и отдача — единой парой цветов --rx/--tx.
const SPEED_RANGES: { id: Range; label: string }[] = [
  { id: 'day', label: 'День' },
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
]

export function SpeedtestCard() {
  // Свой диапазон у графика скорости: замеры редкие (раз в час/3 часа/сутки), поэтому общий переключатель пинга ему не подходит
  const [range, setRange] = useState<Range>('day')
  const qc = useQueryClient()
  const { data, isError } = useQuery({
    queryKey: ['speedtest'],
    queryFn: async () => (await api.get<SpeedtestState>('/internet/speedtest')).data,
    refetchInterval: (q) => (q.state.data?.running ? 2000 : 30_000),
  })
  const start = useMutation({
    mutationFn: () => api.post('/internet/speedtest', {}),
    onSuccess: () => {
      toast.success('Тест запущен — около 20 секунд')
      qc.invalidateQueries({ queryKey: ['speedtest'] })
    },
    onError: (e) => toast.error(errMsg(e)),
  })
  const [time, setTime] = useState('04:00')
  useEffect(() => {
    if (data) setTime(data.schedule.time)
  }, [data?.schedule.time]) // eslint-disable-line react-hooks/exhaustive-deps
  const saveSchedule = useMutation({
    mutationFn: (s: { enabled: boolean; time: string; mode: SpeedMode }) => api.put('/internet/speedtest/schedule', s),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['speedtest'] }),
    onError: (e) => toast.error(errMsg(e)),
  })

  const mode = data?.schedule.mode ?? 'daily'
  const running = data?.running
  const last: SpeedResult | undefined = data?.results[0]
  return (
    <Card className='mt-4 gap-3'>
      <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-2'>
        <CardTitle className='flex items-center gap-2 text-sm font-medium'>
          <Gauge className='size-4 text-brand' aria-hidden='true' /> Скорость интернета
        </CardTitle>
        <Button size='sm' disabled={Boolean(running) || start.isPending} onClick={() => start.mutate()}>
          {running ? <Loader2 className='animate-spin' /> : <Gauge />} {running ? `Идёт: ${running.phase}…` : 'Измерить скорость'}
        </Button>
      </CardHeader>
      <CardContent className='space-y-4 text-sm'>
        {isError ? (
          <NoData reason='бэкенд не ответил' />
        ) : !last ? (
          <p className='text-muted-foreground'>Замеров ещё не было. Нажмите «Измерить скорость» или включите ежедневный замер ниже.</p>
        ) : last.error ? (
          <p className='flex items-start gap-2 text-danger-foreground'>
            <CircleAlert className='mt-0.5 size-4 shrink-0' /> Последний замер ({formatDateTime(last.ts)}) не удался: {last.error}
          </p>
        ) : (
          <div className='space-y-2'>
            <div className='grid grid-cols-2 gap-4 sm:grid-cols-4'>
              <Big label='Загрузка (приём) ↓' flow='rx' value={last.downMbps} />
              <Big label='Отдача ↑' flow='tx' value={last.upMbps} />
              <div>
                <div className='text-xs text-muted-foreground'>Задержка до узла</div>
                <div className='text-2xl font-bold text-info tabular-nums'>{last.latencyMs != null ? `${last.latencyMs} мс` : '—'}</div>
                <div className='text-xs text-muted-foreground'>джиттер {last.jitterMs ?? '—'} мс</div>
              </div>
              <div>
                <div className='text-xs text-muted-foreground'>Узел</div>
                <div className='text-2xl font-bold'>{last.colo ?? '—'}</div>
                <div className='text-xs text-muted-foreground'>Cloudflare</div>
              </div>
            </div>
            <p className='text-xs text-muted-foreground'>
              {formatDateTime(last.ts)} (<Value kind='ago' value={last.ts} />) · {last.trigger === 'schedule' ? 'по расписанию' : 'вручную'} · потрачено {formatBytes(last.bytes)} трафика, {last.durationSec} с
            </p>
          </div>
        )}

        {data && data.results.length > 1 && (
          <div>
            <div className='mb-1 font-medium'>Последние замеры</div>
            <ul className='divide-y'>
              {data.results.slice(0, 8).map((r) => (
                <li key={r.ts} className='flex flex-wrap items-baseline justify-between gap-x-3 py-1.5 text-xs'>
                  <span className='text-time tabular-nums'>{formatDateTime(r.ts)}</span>
                  {r.error ? (
                    <span className='text-danger-foreground'>не удался</span>
                  ) : (
                    <span className='tabular-nums'>
                      <span className='text-rx'>↓ {mbps(r.downMbps)}</span> · <span className='text-tx'>↑ {mbps(r.upMbps)}</span> · {r.latencyMs} мс
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className='flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3'>
          <label className='flex items-center gap-2'>
            <Switch checked={data?.schedule.enabled ?? false} disabled={!data || saveSchedule.isPending} onCheckedChange={(v) => saveSchedule.mutate({ enabled: v, time, mode })} />
            Замер по расписанию
          </label>
          <div className='inline-flex rounded-md border p-0.5' role='group' aria-label='Частота замеров'>
            {MODES.map(({ id: m, label }) => (
              <Button key={m} size='sm' variant={mode === m ? 'default' : 'ghost'} disabled={!data || saveSchedule.isPending} onClick={() => mode !== m && saveSchedule.mutate({ enabled: data?.schedule.enabled ?? false, time, mode: m })}>
                {label}
              </Button>
            ))}
          </div>
          {mode === 'daily' ? (
            <Input
              type='time'
              value={time}
              onChange={(e) => setTime(e.target.value)}
              onBlur={() => data && time !== data.schedule.time && /^\d{2}:\d{2}$/.test(time) && saveSchedule.mutate({ enabled: data.schedule.enabled, time, mode })}
              className='w-28'
              aria-label='Время ежедневного замера'
            />
          ) : (
            <span className='text-xs text-muted-foreground'>{mode === 'every3h' ? 'в 00, 03, 06… ч, в :' : 'каждый час в :'}{String(data?.schedule.hourlyMinute ?? 7).padStart(2, '0')}</span>
          )}
          {mode === 'daily' && data?.schedule.lastDay && <span className='text-xs text-muted-foreground'>последний плановый — {data.schedule.lastDay}</span>}
        </div>
        {data?.backoffUntil && (
          <p className='flex items-start gap-2 text-xs text-warn-foreground'>
            <CircleAlert className='mt-0.5 size-4 shrink-0' /> Cloudflare ограничил частоту тестов — плановые замеры приостановлены до {formatDateTime(data.backoffUntil)}. Кнопка «Измерить скорость» остаётся доступной.
          </p>
        )}

        <div className='flex justify-end'>
          <div className='flex gap-1' role='group' aria-label='Период графика скорости'>
            {SPEED_RANGES.map((r) => (
              <Button key={r.id} size='sm' variant={r.id === range ? 'default' : 'outline'} onClick={() => setRange(r.id)}>
                {r.label}
              </Button>
            ))}
          </div>
        </div>
        <MetricChart
          title='Скорость по замерам, Мбит/с'
          series={[
            { name: 'inet.speed_down', label: 'загрузка ↓', color: 'var(--rx)' },
            { name: 'inet.speed_up', label: 'отдача ↑', color: 'var(--tx)' },
          ]}
          range={range}
          format={(v) => `${v >= 100 ? Math.round(v) : v.toFixed(1)} Мбит/с`}
          domain={[0, 'auto']}
        />

        <p className='text-xs text-muted-foreground'>
          Как это работает: панель скачивает и отдаёт тестовые данные на публичные адреса Cloudflare (speed.cloudflare.com) — без ключей и регистрации. Замер идёт до
          <b> ближайшего</b> узла Cloudflare (сейчас {last?.colo ?? '—'}), поэтому показывает скорость канала до крупного узла, а не до конкретного сайта: у отдельных сервисов маршрут
          может быть медленнее. Тест длится до ~20 с и тратит не более ~450 МБ трафика; пока он идёт, канал занят — пинг и потери на графиках выше могут вырасти, это нормально.
          Ручной замер — не чаще раза в 10 минут: Cloudflare сам ограничивает частые тесты (при серии отвечает отказом примерно на час). «Раз в час» и «Раз в 3 часа» привязаны к часам (замер в :07; для 3 часов — в 00, 03, 06… ч) и не сбивается ручными замерами; если ручной замер был менее 15 минут назад, плановый в этот час пропускается. После отказа Cloudflare плановые замеры замолкают на час. Расход — до ~450 МБ на замер, до ~10 ГБ в сутки при режиме «раз в час», до ~3,6 ГБ при «раз в 3 часа». В график попадают все удачные замеры (ручные и плановые), хранятся месяцами.
        </p>
      </CardContent>
    </Card>
  )
}
