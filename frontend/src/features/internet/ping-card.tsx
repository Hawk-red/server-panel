import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { CircleAlert, Loader2, Play, RotateCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

type Ping = {
  host: string
  ip: string | null
  ts: number
  count: number
  sent: number
  received: number
  lossPct: number
  min: number | null
  avg: number | null
  max: number | null
  error: string | null
}
type HistoryItem = Ping & { pinned: boolean }

const COUNTS = [1, 5, 10]
const errMsg = (e: unknown) => (e instanceof AxiosError && e.response?.data?.message) || 'не удалось выполнить проверку'

// Быстро — зелёный (до 50 мс), медленно — жёлтый (до 150 мс), очень медленно или с потерями — по худшему признаку, нет ответа — красный
type Verdict = { label: string; text: string; dot: string }
export function verdict(p: Pick<Ping, 'received' | 'lossPct' | 'avg'>): Verdict {
  if (p.received === 0) return { label: 'Недоступен', text: 'text-danger-foreground', dot: 'bg-danger' }
  if (p.lossPct >= 50 || (p.avg ?? 0) > 150) return { label: 'Очень медленно', text: 'text-danger-foreground', dot: 'bg-danger' }
  if (p.lossPct > 0 || (p.avg ?? 0) > 50) return { label: p.lossPct > 0 ? 'Есть потери' : 'Медленно', text: 'text-warn-foreground', dot: 'bg-warn' }
  return { label: 'Жив, быстро', text: 'text-ok-foreground', dot: 'bg-ok' }
}
const ms = (v: number | null) => (v == null ? '—' : `${v < 10 ? v.toFixed(1) : Math.round(v)} мс`)
const msLevel = (v: number | null) => (v == null ? '' : v > 150 ? 'text-danger-foreground' : v > 50 ? 'text-warn-foreground' : 'text-ok-foreground')
const lossLevel = (v: number) => (v >= 50 ? 'text-danger-foreground' : v > 0 ? 'text-warn-foreground' : 'text-ok-foreground')

function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className='rounded-lg border bg-muted/30 px-3 py-2'>
      <div className='text-xs text-muted-foreground'>{label}</div>
      <div className={cn('text-xl font-semibold tabular-nums', cls)}>{value}</div>
    </div>
  )
}

// Ручной пингер: адрес → жив/не жив, min/avg/max, потери; история проверок с повтором в один клик
export function PingCard() {
  const qc = useQueryClient()
  const [host, setHost] = useState('')
  const [count, setCount] = useState(5)
  const [result, setResult] = useState<Ping | null>(null)

  const history = useQuery({ queryKey: ['ping-history'], queryFn: async () => (await api.get<HistoryItem[]>('/internet/ping/history')).data })
  const ping = useMutation({
    mutationFn: async (v: { host: string; count: number }) => (await api.post<Ping>('/internet/ping', v)).data,
    onSuccess: (r) => {
      setResult(r)
      qc.invalidateQueries({ queryKey: ['ping-history'] })
    },
    onError: (e) => toast.error(errMsg(e)),
  })
  const forget = useMutation({
    mutationFn: (h: string) => api.delete('/internet/ping/history', { params: { host: h } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ping-history'] }),
    onError: (e) => toast.error(errMsg(e)),
  })

  const run = (h: string, c = count) => {
    if (!h.trim() || ping.isPending) return
    setHost(h)
    ping.mutate({ host: h.trim(), count: c })
  }
  const v = result ? verdict(result) : null

  return (
    <Card className='gap-3'>
      <CardHeader>
        <CardTitle className='text-sm font-medium'>Проверить адрес</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        <form
          className='flex flex-wrap items-center gap-2'
          onSubmit={(e) => {
            e.preventDefault()
            run(host)
          }}
        >
          <Input
            className='h-11 min-w-0 flex-1 basis-56 text-base'
            placeholder='google.com или 8.8.8.8'
            value={host}
            onChange={(e) => setHost(e.target.value)}
            autoCapitalize='none'
            autoCorrect='off'
            spellCheck={false}
            maxLength={300}
            aria-label='Адрес: домен или IP'
          />
          <div className='flex gap-1' role='group' aria-label='Число пакетов'>
            {COUNTS.map((c) => (
              <Button key={c} type='button' size='lg' className='h-11 min-w-11' variant={c === count ? 'default' : 'outline'} onClick={() => setCount(c)} aria-pressed={c === count}>
                {c}
              </Button>
            ))}
          </div>
          <Button type='submit' size='lg' className='h-11' disabled={!host.trim() || ping.isPending}>
            {ping.isPending ? <Loader2 className='animate-spin' /> : <Play />} Пинговать
          </Button>
        </form>

        {ping.isPending && <p className='text-sm text-muted-foreground'>Проверяю {host.trim()}… (до {count} пакетов)</p>}

        {result && v && !ping.isPending && (
          <div className='space-y-3'>
            <div className='flex flex-wrap items-baseline gap-x-4 gap-y-1'>
              <span className={cn('inline-flex items-center gap-2 text-2xl font-bold', v.text)}>
                <span className={cn('size-3 rounded-full', v.dot)} aria-hidden /> {v.label}
              </span>
              <span className='font-mono text-address'>
                {result.host}
                {result.ip && result.ip !== result.host ? ` → ${result.ip}` : ''}
              </span>
            </div>
            {result.error && (
              <p className='flex items-start gap-2 text-sm text-danger-foreground'>
                <CircleAlert className='mt-0.5 size-4 shrink-0' /> {result.error}
              </p>
            )}
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6'>
              <Stat label='минимум' value={ms(result.min)} cls={msLevel(result.min)} />
              <Stat label='среднее' value={ms(result.avg)} cls={msLevel(result.avg)} />
              <Stat label='максимум' value={ms(result.max)} cls={msLevel(result.max)} />
              <Stat label='потери' value={`${result.lossPct}%`} cls={lossLevel(result.lossPct)} />
              <Stat label='отправлено' value={String(result.sent)} />
              <Stat label='получено' value={String(result.received)} cls={result.received === 0 ? 'text-danger-foreground' : undefined} />
            </div>
          </div>
        )}

        <div>
          <div className='mb-1 text-xs text-muted-foreground'>История проверок</div>
          {!history.data || history.data.length === 0 ? (
            <p className='text-sm text-muted-foreground'>Пока пусто — введите адрес и нажмите Enter.</p>
          ) : (
            <ul className='divide-y rounded-lg border'>
              {history.data.map((h) => {
                const hv = verdict(h)
                return (
                  <li key={h.host} className='flex items-center gap-2 px-3 py-1.5'>
                    <button
                      type='button'
                      onClick={() => run(h.host, h.count)}
                      disabled={ping.isPending}
                      className='flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 text-start hover:opacity-80 disabled:opacity-50'
                      title='Пинговать ещё раз'
                    >
                      <span className={cn('size-2.5 shrink-0 rounded-full', hv.dot)} aria-hidden />
                      <span className='min-w-0 truncate font-mono'>{h.host}</span>
                      <span className={cn('text-sm', hv.text)}>{h.received === 0 ? 'недоступен' : `${ms(h.avg)}${h.lossPct > 0 ? `, потери ${h.lossPct}%` : ''}`}</span>
                      <span className='ms-auto text-xs text-muted-foreground'>{formatRelative(h.ts)}</span>
                    </button>
                    <Button type='button' size='icon' variant='ghost' className='size-11' onClick={() => run(h.host, h.count)} disabled={ping.isPending} aria-label={`Повторить ${h.host}`}>
                      <RotateCw />
                    </Button>
                    <Button type='button' size='icon' variant='ghost' className='size-11' onClick={() => forget.mutate(h.host)} aria-label={`Убрать ${h.host} из истории`}>
                      <X />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
