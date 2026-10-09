// Блок «Docker-образы» раздела «Обновления»: версии «было → станет», статусы, замки.
import { useEffect, useRef, useState } from 'react'
import { CircleCheck, CircleDashed, CircleMinus, CircleX, Download, Eye, EyeOff, Loader2, Lock, RefreshCw, TriangleAlert, Undo2 } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatRelative } from '@/lib/format'
import type { DockerImageStatus, DockerJobView, UpdatesSnapshot } from '@/lib/types'
import { cn } from '@/lib/utils'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const shortDigest = (d: string | null) => (d ? d.replace(/^sha256:/, '').slice(0, 8) : '—')
const ver = (v: string) => (/^\d/.test(v) ? `v${v}` : v)

// 17.09 (год добавляем, только если не текущий)
function shortDate(ts: number | null): string {
  if (ts == null) return '—'
  const d = new Date(ts)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return d.getFullYear() === new Date().getFullYear() ? `${dd}.${mm}` : `${dd}.${mm}.${d.getFullYear()}`
}

// «v12.1 → v12.2»; нет метки версии — «сборка 17.09 → 08.10 · 4d616db1 → 03f94a40»
export function imageDelta(d: DockerImageStatus): string {
  const newer = d.upToDate === false
  if (d.localVersion && (!newer || d.remoteVersion)) return newer ? `${ver(d.localVersion)} → ${ver(d.remoteVersion!)}` : ver(d.localVersion)
  if (newer) return `сборка ${shortDate(d.imageCreated)} → ${shortDate(d.remoteCreated)} · ${shortDigest(d.localDigest)} → ${shortDigest(d.remoteDigest)}`
  return `сборка ${shortDate(d.imageCreated)} · ${shortDigest(d.localDigest)}`
}

export function StatusOf({ d }: { d: DockerImageStatus }) {
  if (d.error) return <StatusBadge status='unknown' label='Ошибка проверки' />
  if (d.upToDate === null) return <StatusBadge status='unknown' label='Не проверено' />
  if (d.upToDate) return <StatusBadge status='ok' label='Актуален' />
  return <StatusBadge status='warning' label='Есть новее' />
}

type Action = 'update' | 'rollback'
const RUNNING = (j: DockerJobView | null) => j?.status === 'running' || j?.status === 'queued'

// Опрос последней задачи обновления: пока идёт — раз в 2 секунды, иначе раз в 30
function useDockerJob() {
  const qc = useQueryClient()
  const [job, setJob] = useState<DockerJobView | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [kick, setKick] = useState(0)
  const offsetRef = useRef(0)
  const idRef = useRef<string | null>(null)
  const wasRunning = useRef(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const tick = async () => {
      let next = 30_000
      try {
        const r = (await api.get<DockerJobView>('/system/updates/docker/job', { params: { offset: idRef.current === null ? 0 : offsetRef.current } })).data
        if (stopped) return
        if (idRef.current !== r.id) {
          const asked = offsetRef.current
          idRef.current = r.id
          offsetRef.current = 0
          setLines([])
          setJob(r)
          if (asked > 0) {
            // началась другая задача, а мы просили строки с чужого offset — перечитываем с начала
            timer = setTimeout(tick, 0)
            return
          }
          setLines(r.lines)
        } else if (r.lines.length) setLines((prev) => [...prev, ...r.lines])
        offsetRef.current = r.offset
        setJob(r)
        if (RUNNING(r)) {
          wasRunning.current = true
          next = 2000
        } else if (wasRunning.current) {
          wasRunning.current = false
          void qc.invalidateQueries({ queryKey: ['system-updates'] })
        }
      } catch {
        /* 404 — задач ещё не было; прочие сбои — повторим позже */
      }
      if (!stopped) timer = setTimeout(tick, next)
    }
    void tick()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [kick, qc])

  return { job, lines, restart: () => { wasRunning.current = true; setKick((k) => k + 1) } }
}

function ActionDialog({ d, action, onClose, onStarted }: { d: DockerImageStatus; action: Action; onClose: () => void; onStarted: () => void }) {
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const start = useMutation({
    mutationFn: async () => (await api.post<{ id: string }>(`/system/updates/docker/${d.container}/${action}`, d.danger ? { password } : {})).data,
    onSuccess: () => {
      toast.success(action === 'update' ? 'Обновление запущено' : 'Откат запущен')
      onStarted()
      onClose()
    },
    onError: (e) => {
      setError((e instanceof AxiosError && e.response?.data?.message) || 'не удалось запустить')
      setPassword('')
    },
  })
  const isUpdate = action === 'update'
  return (
    <Dialog open onOpenChange={(o) => !o && !start.isPending && onClose()}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <TriangleAlert className='size-5 text-warn-foreground' /> {isUpdate ? 'Обновить' : 'Откатить'} {d.container}?
          </DialogTitle>
          <DialogDescription asChild>
            <div className='space-y-2 text-sm'>
              <p className='font-mono text-foreground'>
                {isUpdate ? imageDelta(d) : `${d.localVersion ?? 'текущая'} → ${d.rollback?.version ?? 'сохранённая версия'}`}
              </p>
              {d.warning && <p className='text-warn-foreground'>{d.warning}</p>}
              <p>
                {isUpdate
                  ? 'Перед обновлением сохраняются описание контейнера и прежний образ. Если новая версия не запустится или не пройдёт проверку, панель сама вернёт прежнюю.'
                  : 'Контейнер будет пересоздан из сохранённого прежнего образа без скачивания. Данные не откатываются.'}
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <form
          className='space-y-3'
          onSubmit={(e) => {
            e.preventDefault()
            if (!d.danger || password) start.mutate()
          }}
        >
          {d.danger && (
            <>
              <Label htmlFor='docker-action-password'>Пароль панели</Label>
              <div className='relative'>
                <Input id='docker-action-password' type={show ? 'text' : 'password'} autoComplete='off' value={password} onChange={(e) => setPassword(e.target.value)} autoFocus className='pr-10' />
                <button type='button' onClick={() => setShow(!show)} className='absolute inset-y-0 right-2 flex items-center text-muted-foreground' aria-label={show ? 'скрыть пароль' : 'показать пароль'}>
                  {show ? <EyeOff className='size-4' /> : <Eye className='size-4' />}
                </button>
              </div>
            </>
          )}
          {error && <p className='text-sm text-danger-foreground'>{error}</p>}
          <DialogFooter className='gap-2 sm:gap-0'>
            <Button type='button' variant='outline' onClick={onClose} disabled={start.isPending}>
              Отмена
            </Button>
            <Button type='submit' variant={isUpdate ? 'default' : 'destructive'} disabled={(d.danger && !password) || start.isPending}>
              {start.isPending ? 'Запускаю…' : isUpdate ? 'Обновить' : 'Откатить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const STEP_ICON = {
  pending: <CircleDashed className='size-4 text-muted-foreground' />,
  running: <Loader2 className='size-4 animate-spin text-info' />,
  ok: <CircleCheck className='size-4 text-ok-foreground' />,
  error: <CircleX className='size-4 text-danger-foreground' />,
  skipped: <CircleMinus className='size-4 text-muted-foreground' />,
} as const

const JOB_TITLE: Record<DockerJobView['status'], string> = {
  queued: 'Запускается…',
  running: 'Выполняется…',
  ok: 'Готово',
  rolledback: 'Не вышло, выполнен откат',
  error: 'Не удалось',
  failed: 'Не удалось, нужно вмешательство',
}

function DockerJobCard({ job, lines, onHide }: { job: DockerJobView; lines: string[]; onHide: () => void }) {
  const boxRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [lines.length])
  const running = RUNNING(job)
  const bad = job.status === 'error' || job.status === 'failed'
  return (
    <Card className={cn('gap-0 overflow-hidden py-0', running && 'border-info/50', bad && 'border-danger/50')}>
      {running && (
        <div className='h-1 w-full overflow-hidden bg-muted'>
          <div className='h-full w-full animate-pulse bg-info' />
        </div>
      )}
      <div className='flex flex-col gap-1 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <div className='text-sm font-semibold'>
            {job.action === 'rollback' ? 'Откат' : 'Обновление'} {job.container}: {JOB_TITLE[job.status]}
          </div>
          {(job.from || job.to) && (
            <div className='font-mono text-xs text-muted-foreground'>
              {job.from?.version ?? job.from?.id.slice(7, 19) ?? '?'} → {job.to?.version ?? job.to?.id.slice(7, 19) ?? '…'}
            </div>
          )}
        </div>
        {!running && (
          <Button size='sm' variant='ghost' className='self-start' onClick={onHide}>
            Скрыть
          </Button>
        )}
      </div>
      <ol className='grid gap-1.5 border-b px-4 py-3 text-sm'>
        {job.steps.map((s) => (
          <li key={s.id} className='flex items-start gap-2'>
            <span className='mt-0.5 shrink-0'>{STEP_ICON[s.status]}</span>
            <span className={cn(s.status === 'pending' && 'text-muted-foreground')}>
              {s.label}
              {s.detail && <span className='block text-xs break-words text-muted-foreground'>{s.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      {!running && (job.summary || job.error) && (
        <div className={cn('px-4 py-2.5 text-sm font-medium break-words', job.status === 'ok' ? 'bg-ok/10 text-ok-foreground' : job.status === 'rolledback' ? 'bg-warn/10 text-warn-foreground' : 'bg-danger/10 text-danger-foreground')}>
          {job.summary}
          {job.error && <span className='block text-xs font-normal'>{job.error}</span>}
        </div>
      )}
      <pre ref={boxRef} className='max-h-72 min-h-24 overflow-auto bg-muted/30 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap'>
        {lines.length ? lines.join('\n') : 'ожидаю первые строки…'}
      </pre>
    </Card>
  )
}

export function DockerImages({ docker }: { docker: DockerImageStatus[] }) {
  const qc = useQueryClient()
  const { job, lines, restart } = useDockerJob()
  const [dialog, setDialog] = useState<{ d: DockerImageStatus; action: Action } | null>(null)
  const [hidden, setHidden] = useState<string | null>(null)
  const busy = RUNNING(job)
  const newer = docker.filter((d) => d.upToDate === false).length
  const check = useMutation({
    mutationFn: async () => (await api.post<UpdatesSnapshot>('/system/updates/docker/check')).data,
    onSuccess: (data) => {
      qc.setQueryData(['system-updates'], data)
      toast.success('Образы проверены')
    },
    onError: (e) => toast.error((e instanceof AxiosError && e.response?.data?.message) || 'не удалось проверить образы'),
  })
  const showJob = job && hidden !== job.id && (busy || (job.finishedAt ?? 0) > Date.now() - 24 * 3600_000)

  return (
    <div className='space-y-4'>
      <Card className='gap-3'>
        <CardHeader className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
          <CardTitle className='flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium'>
            <span className='flex items-center gap-2'>
              <Download className='size-4 text-info' /> Docker-образы
            </span>
            <span className={newer ? 'text-warn-foreground' : 'text-muted-foreground'}>
              Есть новее: {newer} из {docker.length}
            </span>
          </CardTitle>
          <Button size='sm' variant='outline' className='self-start sm:self-auto' onClick={() => check.mutate()} disabled={check.isPending}>
            {check.isPending ? <Loader2 className='size-4 animate-spin' /> : <RefreshCw className='size-4' />}
            Проверить сейчас
          </Button>
        </CardHeader>
        <CardContent className='grid gap-2'>
          {docker.map((d) => {
            const canUpdate = d.managed && d.upToDate === false
            return (
              <div key={d.container} className='flex flex-col gap-2 rounded-lg border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3'>
                <div className='min-w-0 space-y-0.5'>
                  <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
                    <span className='font-medium'>{d.container}</span>
                    {!d.managed && (
                      <Badge variant='outline' className='text-[10px] font-normal text-muted-foreground' title={d.recreateBlock ?? undefined}>
                        Нельзя пересоздать{d.composeProject ? '' : ' (нет compose)'}
                      </Badge>
                    )}
                  </div>
                  <div className='truncate font-mono text-[11px] text-muted-foreground'>{d.repo}</div>
                  <div className='font-mono text-xs break-words'>{imageDelta(d)}</div>
                  {d.error && <div className='text-[11px] break-words text-danger-foreground'>{d.error}</div>}
                  {d.checkedAt != null && <div className='text-[11px] text-muted-foreground'>проверено {formatRelative(d.checkedAt)}</div>}
                  {d.lock && (
                    <div className='flex items-center gap-1 text-[11px] text-warn-foreground'>
                      <Lock className='size-3 shrink-0' /> Замок: {d.lock}
                    </div>
                  )}
                  {d.note && <div className='text-[11px] text-muted-foreground'>{d.note}</div>}
                </div>
                <div className='flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end'>
                  <StatusOf d={d} />
                  {(canUpdate || d.rollback) && (
                    <div className='flex flex-wrap gap-2'>
                      {canUpdate && (
                        <Button size='sm' disabled={busy || !!d.lock} title={d.lock ? `Замок: ${d.lock}` : busy ? 'Дождитесь окончания текущей задачи' : undefined} onClick={() => setDialog({ d, action: 'update' })}>
                          Обновить…
                        </Button>
                      )}
                      {d.rollback && (
                        <Button size='sm' variant='outline' disabled={busy} title={busy ? 'Дождитесь окончания текущей задачи' : `Вернуть ${d.rollback.version ?? 'прежнюю версию'}`} onClick={() => setDialog({ d, action: 'rollback' })}>
                          <Undo2 className='size-4' /> Откатить
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
      {showJob && <DockerJobCard job={job} lines={lines} onHide={() => setHidden(job.id)} />}
      {dialog && <ActionDialog d={dialog.d} action={dialog.action} onClose={() => setDialog(null)} onStarted={restart} />}
    </div>
  )
}
