import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { ClipboardCopy, Download, PackageCheck, ShieldAlert, Terminal, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import { formatRelative } from '@/lib/format'
import type { UpdatesSnapshot } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Page } from '@/components/layout/page'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { NoData } from '@/components/no-data'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'

type AptJobView = {
  id: string
  mode: 'selected' | 'all'
  packages: string[]
  status: 'running' | 'ok' | 'error'
  exitCode: number | null
  startedAt: number
  finishedAt: number | null
  lines: string[]
  offset: number
  truncated: boolean
}

const shortDigest = (d: string | null) => (d ? d.replace(/^sha256:/, '').slice(0, 12) : '—')

// ---------- мелкие блоки ----------

function Tile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'ok' | 'warn' | 'danger' }) {
  return (
    <div className='rounded-xl border bg-card px-4 py-3'>
      <div className='text-xs text-muted-foreground'>{label}</div>
      <div className={cn('mt-1 text-2xl leading-none font-bold tabular-nums', tone === 'warn' && 'text-warn-foreground', tone === 'danger' && 'text-danger-foreground', tone === 'ok' && 'text-ok-foreground')}>
        {value}
      </div>
      {sub && <div className='mt-1 text-xs text-muted-foreground'>{sub}</div>}
    </div>
  )
}

function CopyCommand({ cmd }: { cmd: string }) {
  return (
    <div className='flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2'>
      <code className='flex-1 overflow-x-auto font-mono text-xs whitespace-nowrap'>{cmd}</code>
      <Button
        size='icon'
        variant='ghost'
        className='size-6 shrink-0'
        onClick={async () => ((await copyText(cmd)) ? toast.success('Скопировано') : toast.error('Не удалось скопировать'))}
        title='Скопировать команду'
      >
        <ClipboardCopy className='size-3.5' />
      </Button>
    </div>
  )
}

// Журнал установки: строки apt как есть, автопрокрутка вниз, пока задача идёт
function JobLog({ job, lines }: { job: AptJobView; lines: string[] }) {
  const boxRef = useRef<HTMLPreElement>(null)
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [lines.length])
  // Секундомер тикает, пока задача идёт; Date.now() не вызываем во время рендера
  useEffect(() => {
    if (job.status !== 'running') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [job.status])
  const dur = Math.max(0, ((job.finishedAt ?? now) || job.startedAt) - job.startedAt) / 1000
  return (
    <Card className='gap-3'>
      <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-2'>
        <CardTitle className='flex items-center gap-2 text-sm font-medium'>
          <Terminal className='size-4' /> Установка: {job.mode === 'all' ? 'все обновления' : `${job.packages.length} пакетов`}
        </CardTitle>
        <div className='flex items-center gap-3 text-xs text-muted-foreground'>
          {job.status === 'running' && <StatusBadge status='unknown' label='идёт установка…' />}
          {job.status === 'ok' && <StatusBadge status='ok' label='готово' />}
          {job.status === 'error' && <StatusBadge status='error' label={`ошибка (код ${job.exitCode ?? '—'})`} />}
          <span className='tabular-nums'>{dur.toFixed(0)} с</span>
        </div>
      </CardHeader>
      <CardContent>
        <pre ref={boxRef} className='max-h-96 min-h-40 overflow-auto rounded-lg bg-muted/40 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap'>
          {lines.length ? lines.join('\n') : 'ожидаю вывод apt…'}
          {job.truncated && '\n… вывод обрезан'}
        </pre>
      </CardContent>
    </Card>
  )
}

// ---------- страница ----------

export function UpdatesPage() {
  return (
    <Page title='Обновления' description='Обновления системы (apt) и Docker-образов на Mac Mini'>
      <Updates />
    </Page>
  )
}

export function Updates() {
  const qc = useQueryClient()
  const { data, isError } = useQuery({
    queryKey: ['system-updates'],
    queryFn: async () => (await api.get<UpdatesSnapshot>('/system/updates')).data,
    refetchInterval: 5 * 60_000,
  })

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<null | 'selected' | 'all'>(null)
  const [jobKey, setJobKey] = useState(0) // меняется при старте новой задачи, перезапускает опрос журнала
  const [job, setJob] = useState<AptJobView | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const offsetRef = useRef(0)

  const apt = data?.apt
  const allNames = apt?.packages.map((p) => p.name) ?? []
  const names = new Set(allNames)
  // Выбор держим только для пакетов, которые ещё в списке обновлений
  const pickedNow = [...selected].filter((n) => names.has(n))

  // Опрос журнала задачи: новые строки дописываются, пока статус running. При открытии страницы
  // показывается последняя задача, если она была.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const tick = async () => {
      try {
        const r = (await api.get<AptJobView>('/system/updates/apt/job', { params: { offset: offsetRef.current } })).data
        if (stopped) return
        setJob(r)
        if (r.lines.length) {
          setLines((prev) => [...prev, ...r.lines])
          offsetRef.current = r.offset
        }
        if (r.status === 'running') timer = setTimeout(tick, 1500)
        else qc.invalidateQueries({ queryKey: ['system-updates'] })
      } catch (e) {
        // 404 — задач ещё не было: это нормально, ничего не показываем
        if (stopped || (e instanceof AxiosError && e.response?.status === 404)) return
        timer = setTimeout(tick, 4000)
      }
    }
    void tick()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [jobKey, qc])

  const start = useMutation({
    mutationFn: async (vars: { mode: 'selected' | 'all'; packages: string[] }) => (await api.post<{ id: string }>('/system/updates/apt/upgrade', vars)).data,
    onSuccess: () => {
      setConfirm(null)
      setSelected(new Set())
      setLines([])
      offsetRef.current = 0
      setJob(null)
      setJobKey((k) => k + 1)
      toast.success('Установка запущена, журнал ниже')
    },
    onError: (e) => {
      setConfirm(null)
      toast.error((e instanceof AxiosError && e.response?.data?.message) || 'не удалось запустить установку')
    },
  })

  if (isError) return <NoData reason='не удалось получить данные об обновлениях' />
  if (!data) return <p className='text-sm text-muted-foreground'>Загрузка…</p>

  const { docker, aptHistory, dockerHistory, dockerTrackingSince } = data
  const running = job?.status === 'running' || start.isPending
  const dockerUpdates = docker.filter((d) => d.upToDate === false).length
  const dockerChecked = docker.filter((d) => d.upToDate !== null).length
  const allPicked = allNames.length > 0 && pickedNow.length === allNames.length
  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  return (
    <div className='space-y-4'>
      {apt?.rebootRequired.required && (
        <div className='flex items-start gap-3 rounded-xl border border-warn/50 bg-warn/5 px-4 py-3'>
          <TriangleAlert className='mt-0.5 size-4 shrink-0 text-warn-foreground' />
          <div className='text-sm'>
            <div className='font-medium'>Нужна перезагрузка</div>
            {apt.rebootRequired.pkgs.length > 0 && <div className='text-xs text-muted-foreground'>Причина: {apt.rebootRequired.pkgs.join(', ')}</div>}
          </div>
        </div>
      )}

      {/* Сводка: четыре показателя, на телефоне в две колонки */}
      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        <Tile
          label='apt-пакеты к обновлению'
          value={allNames.length}
          sub={apt?.checkedAt ? `проверено ${formatRelative(apt.checkedAt)}` : 'проверяется…'}
          tone={apt && apt.securityCount > 0 ? 'warn' : undefined}
        />
        <Tile
          label='из них безопасности'
          value={apt?.securityCount ?? 0}
          sub={apt && apt.securityCount > 0 ? 'стоит поставить в первую очередь' : 'срочных нет'}
          tone={apt && apt.securityCount > 0 ? 'danger' : 'ok'}
        />
        <Tile
          label='Docker-образы с новой версией'
          value={`${dockerUpdates}/${dockerChecked || docker.length}`}
          sub={dockerUpdates ? 'обновите в Portainer' : 'все актуальны'}
          tone={dockerUpdates ? 'warn' : 'ok'}
        />
        <Tile
          label='перезагрузка'
          value={apt?.rebootRequired.required ? 'нужна' : 'не нужна'}
          sub={apt?.rebootRequired.required ? 'после ядра или библиотек' : 'работает на текущем ядре'}
          tone={apt?.rebootRequired.required ? 'warn' : 'ok'}
        />
      </div>

      <div className='grid gap-4 lg:grid-cols-5'>
        {/* apt: список с чекбоксами, полная высота без внутреннего скролла */}
        <Card className='gap-3 lg:col-span-3'>
          <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-2'>
            <CardTitle className='flex items-center gap-2 text-sm font-medium'>
              <PackageCheck className='size-4 text-ok' /> apt-пакеты
            </CardTitle>
            <span className='text-xs text-muted-foreground'>{apt?.error ? 'ошибка проверки' : apt?.checkedAt ? `проверено ${formatRelative(apt.checkedAt)}` : 'проверяется…'}</span>
          </CardHeader>
          <CardContent className='space-y-3'>
            {apt?.error && <NoData reason={apt.error} />}
            {allNames.length === 0 && !apt?.error && <p className='text-sm text-muted-foreground'>все пакеты актуальны</p>}

            {allNames.length > 0 && (
              <>
                <div className='flex flex-col gap-2 rounded-lg bg-muted/40 p-2 sm:flex-row sm:items-center sm:justify-between'>
                  <label className='flex min-h-10 cursor-pointer items-center gap-2 px-2 text-sm'>
                    <Checkbox checked={allPicked} onCheckedChange={(v) => setSelected(v ? new Set(allNames) : new Set())} aria-label='выбрать все' disabled={running} />
                    <span>
                      Выбрано: {pickedNow.length} из {allNames.length}
                    </span>
                  </label>
                  <div className='flex gap-2'>
                    <Button className='flex-1 sm:flex-none' size='sm' variant='outline' disabled={running || pickedNow.length === 0} onClick={() => setConfirm('selected')}>
                      <Download /> Обновить выбранное ({pickedNow.length})
                    </Button>
                    <Button className='flex-1 sm:flex-none' size='sm' disabled={running} onClick={() => setConfirm('all')}>
                      Обновить всё ({allNames.length})
                    </Button>
                  </div>
                </div>

                <ul className='divide-y rounded-lg border'>
                  {apt!.packages.map((p) => {
                    const on = selected.has(p.name)
                    return (
                      <li key={p.name} className={cn('flex items-start gap-3 px-3 py-2.5', on && 'bg-primary/5')}>
                        <Checkbox className='mt-1' checked={on} onCheckedChange={() => toggle(p.name)} aria-label={`выбрать ${p.name}`} disabled={running} />
                        <div className={cn('min-w-0 flex-1', !running && 'cursor-pointer')} onClick={() => !running && toggle(p.name)}>
                          <div className='flex flex-wrap items-center gap-2'>
                            <span className='font-medium break-all'>{p.name}</span>
                            {p.security && (
                              <Badge variant='destructive' className='text-[10px]'>
                                security
                              </Badge>
                            )}
                          </div>
                          {p.description && <div className='line-clamp-1 text-xs text-muted-foreground'>{p.description}</div>}
                        </div>
                        <div className='shrink-0 text-right font-mono text-[11px] leading-tight text-muted-foreground'>
                          <div>{p.from}</div>
                          <div className='text-foreground'>→ {p.to}</div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
                {apt!.heldBack.length > 0 && <p className='text-xs text-muted-foreground'>придержано системой: {apt!.heldBack.join(', ')}</p>}
              </>
            )}
            <div className='space-y-1.5 pt-1'>
              <div className='text-xs text-muted-foreground'>Из терминала, если нужно:</div>
              <CopyCommand cmd='sudo apt update && sudo apt upgrade' />
            </div>
          </CardContent>
        </Card>

        {/* Docker-образы: плитки во всю ширину колонки */}
        <Card className='gap-3 lg:col-span-2'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-sm font-medium'>
              <Download className='size-4 text-info' /> Docker-образы
            </CardTitle>
          </CardHeader>
          <CardContent className='grid gap-2'>
            {docker.map((d) => (
              <div key={d.container} className='flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5'>
                <div className='min-w-0'>
                  <div className='truncate font-medium'>{d.container}</div>
                  <div className='truncate font-mono text-[11px] text-muted-foreground'>{d.repo}</div>
                  {d.imageCreated != null && <div className='text-[11px] text-muted-foreground'>собран {formatRelative(d.imageCreated)}</div>}
                </div>
                <div className='shrink-0'>
                  {d.error ? (
                    <StatusBadge status='unknown' label='ошибка проверки' />
                  ) : d.upToDate === null ? (
                    <StatusBadge status='unknown' label='не проверено' />
                  ) : d.upToDate ? (
                    <StatusBadge status='ok' label='актуально' />
                  ) : (
                    <StatusBadge status='warning' label='есть новее' />
                  )}
                </div>
              </div>
            ))}
            <p className='pt-1 text-[11px] text-muted-foreground'>Образы обновляются в Portainer или командой docker pull с пересозданием контейнера. Панель их не трогает.</p>
          </CardContent>
        </Card>
      </div>

      {job && <JobLog job={job} lines={lines} />}

      <div className={cn('grid gap-4', dockerHistory.length > 0 && 'lg:grid-cols-2')}>
        {/* История apt: плотная сетка */}
        <Card className='gap-3'>
          <CardHeader>
            <CardTitle className='text-sm font-medium'>История apt</CardTitle>
          </CardHeader>
          <CardContent>
            {aptHistory.length === 0 ? (
              <NoData reason='нет записей' />
            ) : (
              <div className='grid gap-x-6 gap-y-3 sm:grid-cols-2'>
                {aptHistory.slice(0, 30).map((e, i) => (
                  <div key={i} className='min-w-0 border-l-2 border-muted pl-3'>
                    <div className='flex items-center gap-2 text-xs text-muted-foreground'>
                      <span>{formatRelative(e.date)}</span>
                      <Badge variant='outline' className='text-[10px]'>
                        {e.manual ? 'вручную' : 'авто'}
                      </Badge>
                    </div>
                    <div className='font-mono text-[11px] leading-relaxed text-muted-foreground'>
                      {e.packages.slice(0, 6).map((p, j) => (
                        <div key={j} className='truncate'>
                          {p.name}: {p.from ? `${p.from} → ${p.to}` : `установлен ${p.to}`}
                        </div>
                      ))}
                      {e.packages.length > 6 && <div>и ещё {e.packages.length - 6}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* История Docker: пока пусто — одна строка, без большого блока */}
        {dockerHistory.length === 0 ? (
          <p className='flex items-center gap-2 rounded-lg border border-dashed px-4 py-2.5 text-xs text-muted-foreground lg:col-span-full'>
            <ShieldAlert className='size-3.5 shrink-0' />
            История Docker-образов: {dockerTrackingSince ? `отслеживаем с ${formatRelative(dockerTrackingSince)}, пока пусто` : 'ещё не начали отслеживать'}
          </p>
        ) : (
          <Card className='gap-3'>
            <CardHeader>
              <CardTitle className='text-sm font-medium'>История Docker-образов</CardTitle>
            </CardHeader>
            <CardContent className='space-y-2'>
              {dockerTrackingSince && <p className='text-xs text-muted-foreground'>Отслеживаем с {formatRelative(dockerTrackingSince)}</p>}
              {dockerHistory.map((e, i) => (
                <div key={i} className='text-sm'>
                  <div className='flex items-center gap-2'>
                    <span className='font-medium'>{e.container}</span>
                    <span className='text-xs text-muted-foreground'>{formatRelative(e.detectedAt)}</span>
                  </div>
                  <div className='font-mono text-xs text-muted-foreground'>
                    {shortDigest(e.oldDigest)} → {shortDigest(e.newDigest)}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={confirm === 'selected'}
        onOpenChange={(o) => !o && !start.isPending && setConfirm(null)}
        title={`Обновить ${pickedNow.length} пакетов?`}
        desc={
          <div className='space-y-2'>
            <p className='text-xs break-words'>
              {pickedNow.slice(0, 25).join(', ')}
              {pickedNow.length > 25 ? ` и ещё ${pickedNow.length - 25}` : ''}
            </p>
            <p>Обновляются только уже установленные пакеты (apt-get install --only-upgrade). Новые пакеты не ставятся.</p>
            <p className='text-warn-foreground'>
              Удалённый доступ: если обновится ssh, сеть или ядро, сессия может прерваться. Установка идёт в фоне, журнал будет виден здесь.
            </p>
          </div>
        }
        confirmText='Обновить'
        isLoading={start.isPending}
        handleConfirm={() => start.mutate({ mode: 'selected', packages: pickedNow })}
      />
      <ConfirmDialog
        open={confirm === 'all'}
        onOpenChange={(o) => !o && !start.isPending && setConfirm(null)}
        title={`Обновить всё (${allNames.length} пакетов)?`}
        desc={
          <div className='space-y-2'>
            <p>apt-get dist-upgrade: все доступные обновления. Пакеты могут получить новые зависимости и, редко, удалить устаревшие.</p>
            <p className='text-warn-foreground'>
              Удалённый доступ: в списке может быть ядро, ssh или сеть. Кабель и VPN останутся, но после обновления ядра может понадобиться перезагрузка (её делаете вы вручную).
            </p>
          </div>
        }
        confirmText='Обновить всё'
        destructive
        isLoading={start.isPending}
        handleConfirm={() => start.mutate({ mode: 'all', packages: [] })}
      />
    </div>
  )
}
