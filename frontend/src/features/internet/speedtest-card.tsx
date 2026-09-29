import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { CircleAlert, Gauge, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatBytes, formatDateTime } from '@/lib/format'
import type { SpeedResult, SpeedtestState } from '@/features/infra-types'
import { NoData } from '@/components/no-data'
import { Value } from '@/components/value'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

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
export function SpeedtestCard() {
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
    mutationFn: (s: { enabled: boolean; time: string }) => api.put('/internet/speedtest/schedule', s),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['speedtest'] }),
    onError: (e) => toast.error(errMsg(e)),
  })

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
            <Switch checked={data?.schedule.enabled ?? false} disabled={!data || saveSchedule.isPending} onCheckedChange={(v) => saveSchedule.mutate({ enabled: v, time })} />
            Замер раз в сутки в
          </label>
          <Input
            type='time'
            value={time}
            onChange={(e) => setTime(e.target.value)}
            onBlur={() => data && time !== data.schedule.time && /^\d{2}:\d{2}$/.test(time) && saveSchedule.mutate({ enabled: data.schedule.enabled, time })}
            className='w-28'
            aria-label='Время ежедневного замера'
          />
          {data?.schedule.lastDay && <span className='text-xs text-muted-foreground'>последний плановый — {data.schedule.lastDay}</span>}
        </div>

        <p className='text-xs text-muted-foreground'>
          Как это работает: панель скачивает и отдаёт тестовые данные на публичные адреса Cloudflare (speed.cloudflare.com) — без ключей и регистрации. Замер идёт до
          <b> ближайшего</b> узла Cloudflare (сейчас {last?.colo ?? '—'}), поэтому показывает скорость канала до крупного узла, а не до конкретного сайта: у отдельных сервисов маршрут
          может быть медленнее. Тест длится до ~20 с и тратит не более ~450 МБ трафика; пока он идёт, канал занят — пинг и потери на графиках выше могут вырасти, это нормально.
          Чаще раза в 10 минут не запускается: Cloudflare сам ограничивает частые замеры (при серии тестов отвечает отказом примерно на час).
        </p>
      </CardContent>
    </Card>
  )
}
