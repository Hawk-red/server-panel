import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { AxiosError } from 'axios'
import { api } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import type { LogLevel, LogLine, LogSource } from '@/lib/types'
import { cn } from '@/lib/utils'
import { NoData } from '@/components/no-data'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

const LEVEL_CLASS: Record<LogLevel, string> = {
  error: 'text-red-600 dark:text-red-400',
  warning: 'text-yellow-700 dark:text-yellow-400',
  info: '',
  debug: 'text-muted-foreground',
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function Logs({ source }: { source?: string }) {
  const navigate = useNavigate({ from: '/system/' })
  const [lines, setLines] = useState('200')
  const [level, setLevel] = useState<'all' | LogLevel>('all')
  const [text, setText] = useState('')
  const [follow, setFollow] = useState(true)
  const q = useDebounced(text, 400)
  const bottom = useRef<HTMLDivElement>(null)

  const sources = useQuery({
    queryKey: ['log-sources'],
    queryFn: async () => (await api.get<LogSource[]>('/logs/sources')).data,
    staleTime: 60_000,
  })
  const current = source ?? 'journal:server-panel.service'
  const log = useQuery({
    queryKey: ['log', current, lines, level, q],
    queryFn: async () =>
      (
        await api.get<{ lines: LogLine[] }>('/logs', {
          params: { source: current, lines, level: level === 'all' ? undefined : level, q: q || undefined },
        })
      ).data,
    refetchInterval: follow ? 5_000 : false,
  })

  useEffect(() => {
    if (follow) bottom.current?.scrollIntoView({ block: 'nearest' })
  }, [log.data, follow])

  const groups = useMemo(() => {
    const m = new Map<string, LogSource[]>()
    for (const s of sources.data ?? []) m.set(s.group, [...(m.get(s.group) ?? []), s])
    // Источник из ссылки (например, лог произвольной службы) — добавляем, если его нет в списке
    if (current.startsWith('journal:') && !(sources.data ?? []).some((s) => s.id === current)) {
      m.set('Службы', [{ id: current, title: current.slice(8), kind: 'journal', group: 'Службы' }, ...(m.get('Службы') ?? [])])
    }
    return [...m.entries()]
  }, [sources.data, current])

  const errorMessage = log.error instanceof AxiosError ? log.error.response?.data?.message : null

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-end gap-3'>
        <div className='min-w-56 flex-1 space-y-1'>
          <Label>Источник</Label>
          <Select value={current} onValueChange={(v) => navigate({ search: { tab: 'logs', source: v } })}>
            <SelectTrigger className='w-full'>
              <SelectValue placeholder='Выберите лог' />
            </SelectTrigger>
            <SelectContent className='max-h-96'>
              {groups.map(([g, items]) => (
                <SelectGroup key={g}>
                  <SelectLabel>{g}</SelectLabel>
                  {items.map((s) => (
                    <SelectItem key={s.id} value={s.id} disabled={s.kind === 'file' && s.readable === false}>
                      {s.title}
                      {s.kind === 'file' && s.size != null && <span className='ms-2 text-xs text-muted-foreground'>{formatBytes(s.size)}</span>}
                      {s.readable === false && <span className='ms-2 text-xs text-muted-foreground'>нет доступа</span>}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1'>
          <Label>Строк</Label>
          <Select value={lines} onValueChange={setLines}>
            <SelectTrigger className='w-24'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['100', '200', '500', '1000', '3000'].map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1'>
          <Label>Уровень</Label>
          <Select value={level} onValueChange={(v) => setLevel(v as typeof level)}>
            <SelectTrigger className='w-36'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>все</SelectItem>
              <SelectItem value='error'>ошибки</SelectItem>
              <SelectItem value='warning'>предупреждения+</SelectItem>
              <SelectItem value='info'>info+</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className='min-w-40 flex-1 space-y-1'>
          <Label>Поиск</Label>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder='текст…' />
        </div>
        <label className='flex h-9 items-center gap-2 text-sm'>
          <Switch checked={follow} onCheckedChange={setFollow} /> Следить
        </label>
      </div>

      <div className='h-[60svh] overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed'>
        {log.isError ? (
          <NoData reason={errorMessage ?? 'ошибка чтения лога'} />
        ) : log.data?.lines.length === 0 ? (
          <span className='text-muted-foreground'>Пусто — нет строк под фильтр.</span>
        ) : (
          log.data?.lines.map((l, i) => (
            <div key={i} className={cn('break-all whitespace-pre-wrap', LEVEL_CLASS[l.level])}>
              {l.ts && <span className='me-2 text-muted-foreground'>{new Date(l.ts).toLocaleString('ru-RU')}</span>}
              {l.text}
            </div>
          ))
        )}
        {log.isError && errorMessage && <p className='mt-2 text-muted-foreground'>{errorMessage}</p>}
        <div ref={bottom} />
      </div>
    </div>
  )
}
