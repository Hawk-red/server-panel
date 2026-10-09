// qBittorrent: «Остановить торренты и обновить» (диалог + окно процесса) и «Остановить все / Запустить все» с учётом того,
// что панель остановила сама. Замок обновления не снимается: торренты сначала останавливаются, потом идёт обычное обновление.
import { useEffect, useState } from 'react'
import { CircleCheck, CircleDashed, CircleMinus, CircleX, Eye, EyeOff, Loader2, Pause, Play, TriangleAlert } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatBytes, formatDuration } from '@/lib/format'
import type { DockerImageStatus, QbtFlow, QbtStopPreview } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FoldButtons, useJobView } from './fold'

const errMsg = (e: unknown, fallback: string) => (e instanceof AxiosError && e.response?.data?.message) || fallback
export const flowActive = (f: QbtFlow | null | undefined) => !!f && ['stopping', 'updating', 'resuming'].includes(f.phase)

export function useQbtFlow() {
  return useQuery({
    queryKey: ['qbt-flow'],
    queryFn: async () => (await api.get<QbtFlow | null>('/system/updates/docker/qbittorrent/flow')).data,
    refetchInterval: (q) => (flowActive(q.state.data) ? 2000 : 30_000),
  })
}

// ---------- «Остановить все» / «Запустить все» ----------
type BulkResult = { stopped?: number; alreadyStopped?: number; started?: number; leftStoppedManually?: number; forgotten?: number }

export function bulkToast(action: 'stop-all' | 'start-all', r: BulkResult): string {
  if (action === 'stop-all') return r.stopped ? `Остановлено торрентов: ${r.stopped}${r.alreadyStopped ? ` (уже были остановлены: ${r.alreadyStopped})` : ''}` : 'Все торренты уже остановлены'
  if (!r.started) return `Запускать нечего: панель не останавливала торренты${r.leftStoppedManually ? ` (остановлены вами: ${r.leftStoppedManually}, не тронуты)` : ''}`
  return `Запущено торрентов: ${r.started}${r.leftStoppedManually ? `; остановленные вами (${r.leftStoppedManually}) не тронуты` : ''}`
}

export function BulkButtons({ disabled, size = 'sm' }: { disabled?: boolean; size?: 'sm' | 'default' }) {
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState<'stop-all' | 'start-all' | null>(null)
  const info = useQuery({
    queryKey: ['torrents-panel-stopped'],
    queryFn: async () => (await api.get<{ count: number; names: string[]; stoppedManually: number }>('/torrents/panel-stopped')).data,
    enabled: confirm === 'start-all',
  })
  const bulk = useMutation({
    mutationFn: async (a: 'stop-all' | 'start-all') => ({ a, r: (await api.post<BulkResult>(`/torrents/${a}`, {})).data }),
    onSuccess: ({ a, r }) => {
      toast.success(bulkToast(a, r))
      void qc.invalidateQueries({ queryKey: ['torrents'] })
      void qc.invalidateQueries({ queryKey: ['system-updates'] })
    },
    onError: (e) => toast.error(errMsg(e, 'ошибка')),
    onSettled: () => setConfirm(null),
  })
  return (
    <>
      <Button size={size} variant='outline' disabled={disabled} onClick={() => setConfirm('stop-all')}>
        <Pause className='size-4' /> Остановить все
      </Button>
      <Button size={size} variant='outline' disabled={disabled} onClick={() => setConfirm('start-all')}>
        <Play className='size-4' /> Запустить все
      </Button>
      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && !bulk.isPending && setConfirm(null)}
          title={confirm === 'stop-all' ? 'Остановить все торренты?' : 'Запустить торренты, остановленные панелью?'}
          desc={
            confirm === 'stop-all'
              ? 'Остановятся и закачки, и раздачи. Панель запомнит, какие именно она остановила: «Запустить все» вернёт только их.'
              : info.data
                ? `Будет запущено: ${info.data.count}${info.data.count ? ` (${info.data.names.slice(0, 3).join(', ')}${info.data.count > 3 ? '…' : ''})` : ''}. Остановленные вами вручную (${info.data.stoppedManually}) не тронем.`
                : 'Запустятся только торренты, которые остановила панель; остановленные вами вручную не тронем.'
          }
          confirmText={confirm === 'stop-all' ? 'Остановить все' : 'Запустить'}
          destructive={confirm === 'stop-all'}
          isLoading={bulk.isPending}
          handleConfirm={() => bulk.mutate(confirm)}
        />
      )}
    </>
  )
}

// ---------- диалог «Остановить торренты и обновить» ----------
export function StopAndUpdateDialog({ d, onClose, onStarted }: { d: DockerImageStatus; onClose: () => void; onStarted: () => void }) {
  const qc = useQueryClient()
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preview = useQuery({
    queryKey: ['qbt-stop-preview'],
    queryFn: async () => (await api.get<QbtStopPreview>('/system/updates/docker/qbittorrent/stop-preview')).data,
    gcTime: 0,
    staleTime: 0,
  })
  const start = useMutation({
    mutationFn: async () => (await api.post('/system/updates/docker/qbittorrent/stop-and-update', { password }, { timeout: 150_000 })).data,
    onSuccess: () => {
      toast.success('Торренты остановлены, обновление запущено')
      void qc.invalidateQueries({ queryKey: ['qbt-flow'] })
      onStarted()
      onClose()
    },
    onError: (e) => {
      setError(errMsg(e, 'не удалось запустить'))
      setPassword('')
      void qc.invalidateQueries({ queryKey: ['qbt-flow'] })
    },
  })
  const p = preview.data
  const blocked = !p || p.blockers.length > 0
  return (
    <Dialog open onOpenChange={(o) => !o && !start.isPending && onClose()}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <TriangleAlert className='size-5 text-warn-foreground' /> Остановить торренты и обновить qBittorrent?
          </DialogTitle>
          <DialogDescription asChild>
            <div className='space-y-2 text-sm'>
              {d.warning && <p className='text-warn-foreground'>{d.warning}</p>}
              <p>
                Сначала остановятся только торренты, которые держат замок (незавершённые закачки). Затем пройдёт обычное обновление с копией настроек.
                <b> После обновления будут запущены только они</b>: остановленные вами раньше и раздачи останутся как были. Замок не отключается, и торренты не удаляются.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-2'>
          {preview.isPending && <p className='text-sm text-muted-foreground'>Проверяю торренты…</p>}
          {preview.isError && <p className='text-sm text-danger-foreground'>{errMsg(preview.error, 'не удалось получить список торрентов')}</p>}
          {p && p.blockers.map((b) => (
            <p key={b} className='flex items-start gap-1.5 text-sm text-danger-foreground'>
              <CircleX className='mt-0.5 size-4 shrink-0' /> Сейчас нельзя: {b}
            </p>
          ))}
          {p && (
            <div className='rounded-lg border'>
              <div className='border-b px-3 py-1.5 text-xs text-muted-foreground'>Остановятся: {p.torrents.length} из {p.total}</div>
              {p.torrents.length === 0 ? (
                <p className='px-3 py-2 text-sm text-muted-foreground'>Нет закачек, которые держат замок — остановка не потребуется.</p>
              ) : (
                <ul className='max-h-48 divide-y overflow-auto text-sm'>
                  {p.torrents.map((t) => (
                    <li key={t.hash} className='flex items-start justify-between gap-3 px-3 py-1.5'>
                      <span className='min-w-0 break-words'>{t.name}</span>
                      <span className='shrink-0 text-right font-mono text-[11px] text-muted-foreground'>
                        {(t.progress * 100).toFixed(0)}% · {formatBytes(t.size)}
                        <br />
                        {t.state}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <form
          className='space-y-3'
          onSubmit={(e) => {
            e.preventDefault()
            if (password && !blocked) start.mutate()
          }}
        >
          <Label htmlFor='qbt-flow-password'>Пароль панели</Label>
          <div className='relative'>
            <Input id='qbt-flow-password' type={show ? 'text' : 'password'} autoComplete='off' value={password} onChange={(e) => setPassword(e.target.value)} autoFocus className='pr-10' />
            <button type='button' onClick={() => setShow(!show)} className='absolute inset-y-0 right-2 flex items-center text-muted-foreground' aria-label={show ? 'скрыть пароль' : 'показать пароль'}>
              {show ? <EyeOff className='size-4' /> : <Eye className='size-4' />}
            </button>
          </div>
          {error && <p className='text-sm break-words text-danger-foreground'>{error}</p>}
          <DialogFooter className='gap-2 sm:gap-0'>
            <Button type='button' variant='outline' onClick={onClose} disabled={start.isPending}>
              Отмена
            </Button>
            <Button type='submit' disabled={!password || blocked || start.isPending}>
              {start.isPending ? 'Останавливаю торренты…' : 'Остановить и обновить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------- окно процесса: Остановка → Обновление → Возобновление ----------
type StepStatus = 'pending' | 'running' | 'ok' | 'error' | 'skipped'
const ICON: Record<StepStatus, React.ReactNode> = {
  pending: <CircleDashed className='size-4 text-muted-foreground' />,
  running: <Loader2 className='size-4 animate-spin text-info' />,
  ok: <CircleCheck className='size-4 text-ok-foreground' />,
  error: <CircleX className='size-4 text-danger-foreground' />,
  skipped: <CircleMinus className='size-4 text-muted-foreground' />,
}

function stepsOf(f: QbtFlow): { label: string; status: StepStatus; detail?: string }[] {
  const names = f.torrents.slice(0, 3).map((t) => t.name).join(', ') + (f.torrents.length > 3 ? '…' : '')
  const never = f.phase === 'error' && f.jobId === null // обновление так и не началось
  const stop: { label: string; status: StepStatus; detail?: string } = {
    label: 'Остановка торрентов',
    status: f.phase === 'stopping' ? 'running' : never && f.stoppedCount === 0 ? 'error' : 'ok',
    detail: f.torrents.length ? `${f.stoppedCount || f.torrents.length} шт.: ${names}` : 'закачек, которые держат замок, не было',
  }
  const jobBad = f.jobStatus === 'error' || f.jobStatus === 'failed'
  const upd: { label: string; status: StepStatus; detail?: string } = {
    label: 'Обновление qBittorrent',
    status: never ? 'skipped' : f.phase === 'stopping' ? 'pending' : f.phase === 'updating' ? 'running' : f.jobStatus === 'ok' ? 'ok' : f.jobStatus === 'rolledback' || jobBad ? 'error' : 'ok',
    detail: f.phase === 'updating' ? 'шаги помощника — в окне ниже' : f.jobStatus === 'rolledback' ? 'не удалось, выполнен откат на прежнюю версию' : jobBad ? 'не удалось' : (f.jobSummary ?? undefined),
  }
  const res: { label: string; status: StepStatus; detail?: string } = {
    label: 'Возобновление торрентов',
    status: f.phase === 'done' ? 'ok' : f.phase === 'resuming' ? 'running' : f.phase === 'error' ? (f.resumedCount !== null && never ? 'ok' : 'error') : 'pending',
    detail: f.resumedCount !== null ? `запущено: ${f.resumedCount}` : f.phase === 'resuming' ? 'жду, пока qBittorrent ответит' : undefined,
  }
  return [stop, upd, res]
}

const FLOW_TITLE: Record<QbtFlow['phase'], string> = {
  stopping: 'останавливаю торренты…',
  updating: 'идёт обновление…',
  resuming: 'возобновляю торренты…',
  done: 'готово',
  error: 'не удалось',
}

export function QbtFlowCard({ flow }: { flow: QbtFlow }) {
  const active = flowActive(flow)
  const view = useJobView('updates.qbtFlow.view', flow.id, flow.phase === 'done' && flow.jobStatus === 'ok')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  if (view.hidden) return null
  const good = flow.phase === 'done' && flow.jobStatus === 'ok'
  const warn = flow.phase === 'done' && flow.jobStatus !== 'ok'
  const tone = good ? 'text-ok-foreground' : warn ? 'text-warn-foreground' : 'text-danger-foreground'
  const Icon = good ? CircleCheck : warn ? TriangleAlert : CircleX
  const dur = Math.max(0, (flow.finishedAt ?? now) - flow.startedAt) / 1000
  const title = `qBittorrent, остановить торренты и обновить: ${FLOW_TITLE[flow.phase]}`

  if (view.collapsed && !active) {
    return (
      <Card className='gap-0 py-0'>
        <div className='flex flex-wrap items-center justify-between gap-2 px-4 py-2.5'>
          <div className={cn('flex min-w-0 items-center gap-2 text-sm font-medium', tone)}>
            <Icon className='size-4 shrink-0' />
            <span className='break-words'>
              {title}
              {flow.resumedCount !== null && ` · возобновлено ${flow.resumedCount}`} · {formatDuration(Math.round(dur))}
            </span>
          </div>
          <FoldButtons collapsed onToggle={() => view.setCollapsed(false)} onHide={view.hide} />
        </div>
      </Card>
    )
  }
  return (
    <Card className={cn('gap-0 overflow-hidden py-0', active && 'border-info/50')}>
      {active && (
        <div className='h-1 w-full overflow-hidden bg-muted'>
          <div className='h-full w-full animate-pulse bg-info' />
        </div>
      )}
      <div className='flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex items-center gap-3'>
          {active ? <Loader2 className='size-5 shrink-0 animate-spin text-info' /> : <Icon className={cn('size-5 shrink-0', tone)} />}
          <div className={cn('text-sm font-semibold', active && 'text-info')}>{title}</div>
        </div>
        <div className='flex flex-wrap items-center gap-3 text-sm tabular-nums'>
          <span className='font-mono font-semibold'>{Math.round(dur)} с</span>
          {!active && <FoldButtons collapsed={false} onToggle={() => view.setCollapsed(true)} onHide={view.hide} />}
        </div>
      </div>
      <ol className='grid gap-1.5 px-4 py-3 text-sm'>
        {stepsOf(flow).map((s) => (
          <li key={s.label} className='flex items-start gap-2'>
            <span className='mt-0.5 shrink-0'>{ICON[s.status]}</span>
            <span className={cn(s.status === 'pending' && 'text-muted-foreground')}>
              {s.label}
              {s.detail && <span className='block text-xs break-words text-muted-foreground'>{s.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      {flow.error && <div className={cn('border-t px-4 py-2.5 text-sm break-words', flow.phase === 'error' ? 'bg-danger/10 text-danger-foreground' : 'text-muted-foreground')}>{flow.error}</div>}
    </Card>
  )
}
