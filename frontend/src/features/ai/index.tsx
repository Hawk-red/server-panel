import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot, Eraser, Send, Settings2, Square } from 'lucide-react'
import { api } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import { Page } from '@/components/layout/page'
import { StatusBadge, type Status } from '@/components/status-badge'
import { UnitControls } from '@/components/unit-controls'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

type AiStatus = {
  service: { unit: string; active: string }
  engine: { name: string; version: string | null }
  model: { name: string; parameters: string; quantization: string; family: string; sizeBytes: number; contextLength: number | null } | null
  loaded: { sizeBytes: number; vramBytes: number; expiresAt: string; contextLength: number | null } | null
  numCtx: number
  disk: { free: number; total: number } | null
}

type AiSettings = {
  promptEnabled: boolean
  prompt: string
  contextEnabled: boolean
  context: string
  defaults: { prompt: string; context: string }
}

type Stats = { tokens: number; tokensPerSec: number; seconds: number }
type Msg = { role: 'user' | 'assistant'; content: string; stopped?: boolean; error?: string; stats?: Stats }

// Строка из NDJSON-потока Ollama (/api/chat, stream: true)
type ChatEvent = {
  message?: { content?: string }
  done?: boolean
  error?: string
  eval_count?: number
  eval_duration?: number
  total_duration?: number
}

const SERVICE_STATUS: Record<string, { status: Status; label: string }> = {
  active: { status: 'ok', label: 'запущена' },
  inactive: { status: 'unknown', label: 'остановлена' },
  failed: { status: 'error', label: 'сбой' },
}

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Системный промпт и справка — редактируются здесь и хранятся на сервере
function SettingsDialog({ settings, onSaved }: { settings: AiSettings; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(settings)
  const [saving, setSaving] = useState(false)

  const handleOpen = (o: boolean) => {
    if (o) setForm(settings)
    setOpen(o)
  }

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/ai/settings', {
        promptEnabled: form.promptEnabled,
        prompt: form.prompt,
        contextEnabled: form.contextEnabled,
        context: form.context,
      })
      onSaved()
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button size='sm' variant='outline'>
          <Settings2 /> Настройки
        </Button>
      </DialogTrigger>
      <DialogContent className='max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Настройки чата</DialogTitle>
          <DialogDescription>Применяются к следующему сообщению. Текущий диалог не сбрасывается.</DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div className='flex items-center justify-between gap-3'>
            <Label htmlFor='ai-prompt-on'>Системный промпт</Label>
            <Switch id='ai-prompt-on' checked={form.promptEnabled} onCheckedChange={(v) => setForm({ ...form, promptEnabled: v })} />
          </div>
          <Textarea
            rows={5}
            value={form.prompt}
            disabled={!form.promptEnabled}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            className='font-mono text-sm'
          />
        </div>

        <div className='space-y-3'>
          <div className='flex items-center justify-between gap-3'>
            <div>
              <Label htmlFor='ai-context-on'>Добавлять справку о сервере</Label>
              <p className='text-xs text-muted-foreground'>Выключено по умолчанию. Без паролей и ключей, но отправляется в модель с каждым сообщением: держите коротко.</p>
            </div>
            <Switch id='ai-context-on' checked={form.contextEnabled} onCheckedChange={(v) => setForm({ ...form, contextEnabled: v })} />
          </div>
          <Textarea
            rows={8}
            value={form.context}
            disabled={!form.contextEnabled}
            onChange={(e) => setForm({ ...form, context: e.target.value })}
            className='font-mono text-sm'
          />
        </div>

        <DialogFooter className='gap-2 sm:justify-between'>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => setForm({ ...form, prompt: settings.defaults.prompt, context: settings.defaults.context })}
          >
            Вернуть тексты по умолчанию
          </Button>
          <div className='flex gap-2'>
            <Button variant='outline' onClick={() => setOpen(false)} disabled={saving}>
              Отмена
            </Button>
            <Button onClick={save} disabled={saving}>
              Сохранить
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AiChat() {
  const statusQ = useQuery({
    queryKey: ['ai-status'],
    queryFn: async () => (await api.get<AiStatus>('/ai/status')).data,
    refetchInterval: 5000,
  })
  const settingsQ = useQuery({
    queryKey: ['ai-settings'],
    queryFn: async () => (await api.get<AiSettings>('/ai/settings')).data,
  })

  const status = statusQ.data
  const running = status?.service.active === 'active'
  const svc = SERVICE_STATUS[status?.service.active ?? ''] ?? { status: 'unknown' as Status, label: status?.service.active ?? 'нет данных' }

  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Таймер ожидания: пока модель думает, видно, сколько идёт запрос
  useEffect(() => {
    if (!streaming) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [streaming])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  // Меняет только последнее (ассистентское) сообщение
  const patchLast = (patch: Partial<Msg>) =>
    setMessages((prev) => {
      const copy = [...prev]
      copy[copy.length - 1] = { ...copy[copy.length - 1], ...patch }
      return copy
    })

  async function send() {
    const text = input.trim()
    if (!text || streaming || !running) return
    const history: Msg[] = [...messages, { role: 'user', content: text }]
    setMessages([...history, { role: 'assistant', content: '' }])
    setInput('')
    setStreaming(true)
    setStartedAt(Date.now())
    setNow(Date.now())

    // fetch, а не axios: у axios глобальный таймаут 15 с, а ответ может идти 10+ минут
    const ctrl = new AbortController()
    abortRef.current = ctrl
    let answer = ''
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { message?: string } | null
        throw new Error(j?.message ?? `ошибка ${res.status}`)
      }
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let stats: Stats | undefined
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          const ev = JSON.parse(line) as ChatEvent
          if (ev.error) throw new Error(ev.error)
          const piece = ev.message?.content
          if (piece) {
            answer += piece
            patchLast({ content: answer })
          }
          if (ev.done) {
            const tokens = ev.eval_count ?? 0
            stats = {
              tokens,
              tokensPerSec: ev.eval_duration ? tokens / (ev.eval_duration / 1e9) : 0,
              seconds: (ev.total_duration ?? 0) / 1e9,
            }
          }
        }
      }
      patchLast({ content: answer, stats })
    } catch (e) {
      if (ctrl.signal.aborted) patchLast({ content: answer, stopped: true })
      else patchLast({ content: answer, error: (e as Error).message })
    } finally {
      abortRef.current = null
      setStreaming(false)
      statusQ.refetch()
    }
  }

  const elapsed = streaming ? now - startedAt : 0
  const lastAssistant = messages[messages.length - 1]
  const waitingFirstToken = streaming && !lastAssistant?.content
  const phase = !streaming
    ? null
    : waitingFirstToken
      ? status?.loaded
        ? 'модель обрабатывает запрос…'
        : 'модель загружается в память и обрабатывает запрос (первый ответ после простоя идёт дольше)…'
      : 'модель печатает…'

  return (
    <Page title='Локальный AI' description='Ollama на этом сервере: модель работает локально, данные не уходят наружу'>
      <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'>
        <Card className='gap-3'>
          <CardHeader>
            <CardTitle className='text-sm font-medium'>Движок и модель</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3 text-sm'>
            <div className='flex items-center justify-between gap-2'>
              <span className='text-muted-foreground'>Служба</span>
              <StatusBadge status={svc.status} label={svc.label} />
            </div>
            <div className='flex justify-between gap-2'>
              <span className='text-muted-foreground'>Движок</span>
              <span>
                {status?.engine.name ?? '—'} {status?.engine.version ?? ''}
              </span>
            </div>
            <div className='flex justify-between gap-2'>
              <span className='text-muted-foreground'>Модель</span>
              <span className='text-right'>{status?.model?.name ?? '—'}</span>
            </div>
            {status?.model && (
              <div className='flex justify-between gap-2'>
                <span className='text-muted-foreground'>Параметры</span>
                <span>
                  {status.model.parameters}, {status.model.quantization}
                </span>
              </div>
            )}
            <div className='flex justify-between gap-2'>
              <span className='text-muted-foreground'>Размер на диске</span>
              <span>{status?.model ? formatBytes(status.model.sizeBytes) : '—'}</span>
            </div>
            <div className='flex justify-between gap-2'>
              <span className='text-muted-foreground'>Контекст</span>
              <span>{status ? `${status.numCtx} токенов` : '—'}</span>
            </div>
            <div className='flex justify-between gap-2'>
              <span className='text-muted-foreground'>В памяти</span>
              <span className='text-right'>
                {status?.loaded ? `${formatBytes(status.loaded.sizeBytes)} RAM` : running ? 'выгружена' : 'нет'}
              </span>
            </div>
            <div className='flex justify-between gap-2'>
              <span className='text-muted-foreground'>Свободно на диске</span>
              <span>{status?.disk ? formatBytes(status.disk.free) : '—'}</span>
            </div>
            <p className='text-xs text-muted-foreground'>
              Модель выгружается из памяти через 5 минут простоя. Модель займёт около 9 ГБ RAM, а ответы на этом процессоре идут примерно со скоростью 1 токен в секунду.
            </p>
            <div className='pt-1'>
              <UnitControls
                unit='ollama.service'
                title='Ollama'
                active={running}
                warning='Модель выгрузится из памяти, идущий ответ чата прервётся.'
                startWarning='Модель займёт около 9 ГБ RAM. Первый ответ после запуска ждёт загрузку модели, ответы медленные (около 1 токена в секунду).'
                invalidate={['ai-status']}
              />
            </div>
          </CardContent>
        </Card>

        <Card className='gap-0 overflow-hidden p-0'>
          <div className='flex items-center justify-between gap-2 border-b px-4 py-2.5'>
            <span className='flex items-center gap-2 text-sm font-medium'>
              <Bot className='size-4 text-brand' /> Чат
            </span>
            <div className='flex gap-2'>
              {settingsQ.data && <SettingsDialog settings={settingsQ.data} onSaved={() => settingsQ.refetch()} />}
              <Button
                size='sm'
                variant='ghost'
                disabled={streaming || messages.length === 0}
                onClick={() => setMessages([])}
              >
                <Eraser /> Очистить
              </Button>
            </div>
          </div>

          <div className='flex h-[60vh] min-h-72 flex-col gap-3 overflow-y-auto p-4'>
            {messages.length === 0 && (
              <p className='m-auto text-center text-sm text-muted-foreground'>
                {running ? 'Задайте вопрос. Ctrl+Enter отправляет, Enter переносит строку.' : 'Ollama не запущена. Нажмите «Запустить» слева.'}
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'ml-auto max-w-[85%]' : 'mr-auto max-w-[90%]'}>
                <div
                  className={
                    m.role === 'user'
                      ? 'rounded-lg bg-muted px-3 py-2 text-sm break-words whitespace-pre-wrap'
                      : 'rounded-lg border bg-card px-3 py-2 text-sm break-words whitespace-pre-wrap'
                  }
                >
                  {m.content || (m.role === 'assistant' && streaming && i === messages.length - 1 ? '…' : '')}
                  {m.stopped && <span className='ml-2 text-xs text-muted-foreground'>[остановлено]</span>}
                  {m.error && <div className='mt-2 text-xs text-danger-foreground'>⚠ {m.error}</div>}
                </div>
                {m.stats && (
                  <div className='mt-1 px-1 text-xs text-muted-foreground'>
                    {m.stats.tokens} токенов · {m.stats.tokensPerSec.toFixed(1)} ток/с · {m.stats.seconds.toFixed(0)} с
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className='space-y-2 border-t p-3'>
            {streaming && (
              <div className='flex items-center justify-between text-xs text-muted-foreground'>
                <span className='flex items-center gap-2'>
                  <span className='size-2 animate-pulse rounded-full bg-brand' aria-hidden='true' />
                  {phase}
                </span>
                <span className='tabular-nums'>{mmss(elapsed)}</span>
              </div>
            )}
            <div className='flex items-end gap-2'>
              <Textarea
                rows={3}
                value={input}
                disabled={!running}
                placeholder={running ? 'Сообщение… (Ctrl+Enter — отправить)' : 'Ollama не запущена'}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    void send()
                  }
                }}
                className='max-h-64 min-h-16 resize-y'
              />
              {streaming ? (
                <Button variant='destructive' onClick={() => abortRef.current?.abort()}>
                  <Square /> Стоп
                </Button>
              ) : (
                <Button onClick={() => void send()} disabled={!running || !input.trim()}>
                  <Send /> Отправить
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>
    </Page>
  )
}
