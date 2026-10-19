import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AxiosError } from 'axios'
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ExternalLink, Info, Loader2, Menu, Minus, Plus, Power, Settings2, Undo2, VolumeX } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { RECEIVER_LINK_GROUPS } from '@/lib/receiver-links'
import { activeInput, activeMode, bumpVolume, createHold, formatDb, inputIcon, levelFraction, type CmdResult, type ReceiverFullState } from '@/lib/receiver-remote'
import { Page } from '@/components/layout/page'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { HomeLink } from '@/components/home-link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ReceiverControls } from './receiver-controls'

type ApiError = { message?: string; code?: string }
const errInfo = (e: unknown) => {
  const ax = e instanceof AxiosError ? e : null
  const d = ax?.response?.data as ApiError | undefined
  return { status: ax?.response?.status ?? 0, message: d?.message ?? 'Не удалось связаться с ресивером', code: d?.code ?? (ax?.response ? '' : 'offline') }
}
const buzz = () => {
  try {
    navigator.vibrate?.(10)
  } catch {
    /* не поддерживается */
  }
}

// Смысловые цвета: активное — залитое (белый текст на тёмном фоне ≥ 4,5:1), неактивное — контур
const MODES = [
  { cmd: 'MSMOVIE', label: 'Movie', on: 'bg-blue-700 text-white border-blue-700 dark:bg-blue-600 dark:border-blue-600', off: 'text-blue-700 border-blue-700/40 dark:text-blue-300 dark:border-blue-300/40' },
  { cmd: 'MSMUSIC', label: 'Music', on: 'bg-violet-700 text-white border-violet-700 dark:bg-violet-600 dark:border-violet-600', off: 'text-violet-700 border-violet-700/40 dark:text-violet-300 dark:border-violet-300/40' },
  { cmd: 'MSGAME', label: 'Game', on: 'bg-orange-700 text-white border-orange-700 dark:bg-orange-600 dark:border-orange-600', off: 'text-orange-700 border-orange-700/40 dark:text-orange-300 dark:border-orange-300/40' },
  { cmd: 'MSDIRECT', label: 'Direct', on: 'bg-teal-700 text-white border-teal-700 dark:bg-teal-600 dark:border-teal-600', off: 'text-teal-700 border-teal-700/40 dark:text-teal-300 dark:border-teal-300/40' },
  { cmd: 'MSSTEREO', label: 'Stereo', on: 'bg-pink-700 text-white border-pink-700 dark:bg-pink-600 dark:border-pink-600', off: 'text-pink-700 border-pink-700/40 dark:text-pink-300 dark:border-pink-300/40' },
]

function useRemote() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['receiver'],
    queryFn: async () => (await api.get<ReceiverFullState>('/receiver')).data,
    refetchInterval: 10_000, // пока вкладка открыта (в фоне react-query не опрашивает)
    retry: false,
  })
  const [pending, setPending] = useState<string | null>(null)
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Полное состояние — через 1,5 с после серии кликов
  const scheduleRefresh = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current)
    refetchTimer.current = setTimeout(() => void qc.invalidateQueries({ queryKey: ['receiver'] }), 1500)
  }, [qc])
  useEffect(() => () => void (refetchTimer.current && clearTimeout(refetchTimer.current)), [])

  const patch = useCallback((fn: (s: ReceiverFullState) => ReceiverFullState) => qc.setQueryData<ReceiverFullState>(['receiver'], (s) => (s ? fn(s) : s)), [qc])

  /** quiet — частые команды (громкость, навигация): без блокировки кнопок и без тостов о частоте */
  const send = useCallback(
    async (command: string, opts: { quiet?: boolean } = {}): Promise<CmdResult | null> => {
      if (!opts.quiet) setPending(command)
      try {
        const r = (await api.post<CmdResult>('/receiver/command', { command })).data
        if (r.state) qc.setQueryData(['receiver'], r.state)
        else if (r.volume !== null) patch((s) => ({ ...s, volume: r.volume, volumeDb: r.volume! - 80 }))
        if (!r.accepted) toast.error(r.message ?? `Ресивер не принял команду ${command}`)
        if (opts.quiet) scheduleRefresh()
        return r
      } catch (e) {
        const i = errInfo(e)
        if (i.status !== 429) toast.error(i.message)
        void qc.invalidateQueries({ queryKey: ['receiver'] })
        return null
      } finally {
        if (!opts.quiet) setPending(null)
      }
    },
    [qc, patch, scheduleRefresh],
  )
  return { q, pending, send, patch }
}

/** Кнопка с удержанием: pointerdown — команда и повтор, pointerup/leave/cancel — стоп */
function useHoldButton(fire: () => void) {
  const fireRef = useRef(fire)
  const holdRef = useRef<ReturnType<typeof createHold> | null>(null)
  useEffect(() => {
    fireRef.current = fire
  })
  useEffect(() => {
    holdRef.current = createHold(() => fireRef.current())
    return () => holdRef.current?.stop()
  }, [])
  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      buzz()
      holdRef.current?.start()
    },
    onPointerUp: () => holdRef.current?.stop(),
    onPointerLeave: () => holdRef.current?.stop(),
    onPointerCancel: () => holdRef.current?.stop(),
    onContextMenu: (e: React.SyntheticEvent) => e.preventDefault(),
  }
}

const touch = { touchAction: 'manipulation' } as const

export function ReceiverRemote() {
  const { q, pending, send, patch } = useRemote()
  const st = q.data
  const err = q.isError ? errInfo(q.error) : null
  const on = st?.power === 'ON'
  const [confirmOff, setConfirmOff] = useState(false)
  const [lastQuick, setLastQuick] = useState<string | null>(null)
  const [lastMode, setLastMode] = useState<{ cmd: string; modeAtClick: string | null } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [soundOpen, setSoundOpen] = useState(false)

  const connection = err ? (err.code === 'busy' ? { label: 'занят', cls: 'bg-amber-500' } : { label: 'недоступен', cls: 'bg-red-600' }) : st ? { label: 'на связи', cls: 'bg-emerald-600' } : { label: 'подключаюсь…', cls: 'bg-muted-foreground' }

  const volStep = (command: 'MVUP' | 'MVDOWN') => () => {
    patch((s) => bumpVolume(s, command))
    void send(command, { quiet: true })
  }
  const upHold = useHoldButton(volStep('MVUP'))
  const downHold = useHoldButton(volStep('MVDOWN'))
  const nav = (command: string) => () => void send(command, { quiet: true })
  const holdUp = useHoldButton(nav('MNCUP'))
  const holdDown = useHoldButton(nav('MNCDN'))
  const holdLeft = useHoldButton(nav('MNCLT'))
  const holdRight = useHoldButton(nav('MNCRT'))

  const inputs = st?.inputs ?? []
  const curInput = activeInput(st, inputs)
  const curMode = activeMode(st?.mode ?? null, lastMode)
  const disabled = !on
  const muteOn = st?.mute === true

  return (
    <Page title='Пульт ресивера' description='Marantz NR1604'>
      <div className='mx-auto flex w-full max-w-md flex-col gap-4 pb-[env(safe-area-inset-bottom)] sm:max-w-xl' style={touch}>
        {/* Шапка */}
        <Card className='py-3'>
          <CardContent className='flex items-center gap-3'>
            <Button asChild variant='ghost' size='icon' className='size-12 shrink-0' aria-label='Назад к «Медиа»'>
              <Link to='/media'>
                <ArrowLeft />
              </Link>
            </Button>
            <div className='min-w-0 flex-1'>
              <div className='truncate text-base font-semibold'>Marantz NR1604</div>
              <div className='flex items-center gap-1.5 text-xs text-muted-foreground' role='status'>
                <span className={cn('inline-block size-2 rounded-full', connection.cls)} aria-hidden /> {connection.label}
                {st?.power === 'STANDBY' && ' · выключен'}
              </div>
            </div>
            <Button
              size='icon'
              aria-label={on ? 'Выключить ресивер' : 'Включить ресивер'}
              aria-pressed={on}
              disabled={!st || pending === 'PWON' || pending === 'PWSTANDBY'}
              className={cn('size-14 shrink-0 rounded-full', on ? 'bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500' : 'bg-muted text-muted-foreground hover:bg-muted/80')}
              onClick={() => {
                buzz()
                if (on) setConfirmOff(true)
                else void send('PWON')
              }}
            >
              {pending === 'PWON' || pending === 'PWSTANDBY' ? <Loader2 className='size-6 animate-spin' /> : <Power className='size-6' />}
            </Button>
          </CardContent>
        </Card>

        {err && <p className='rounded-md border border-destructive/40 p-3 text-sm text-destructive'>{err.message}</p>}
        {st?.power === 'STANDBY' && <p className='rounded-md border p-3 text-sm text-muted-foreground'>Ресивер выключен. Нажмите кнопку питания, чтобы включить.</p>}

        <div className={cn('flex flex-col gap-4 transition-opacity', disabled && 'pointer-events-none opacity-50')} aria-disabled={disabled}>
          {/* Громкость */}
          <Card>
            <CardContent className='space-y-3'>
              <div className='flex items-center justify-between gap-3'>
                <Button variant='outline' className='size-16 rounded-2xl' aria-label='Тише' disabled={disabled} {...downHold} style={touch}>
                  <Minus className='size-7' />
                </Button>
                <div className='text-center'>
                  <div className='text-3xl font-bold tabular-nums' aria-live='polite'>
                    {formatDb(st?.volume ?? null)}
                  </div>
                  <div className='text-xs text-muted-foreground'>громкость</div>
                </div>
                <Button variant='outline' className='size-16 rounded-2xl' aria-label='Громче' disabled={disabled} {...upHold} style={touch}>
                  <Plus className='size-7' />
                </Button>
              </div>
              <div className='relative h-2 rounded-full bg-muted' role='img' aria-label={`Уровень ${formatDb(st?.volume ?? null)}, потолок ${formatDb(st?.maxVolume ?? null)}`}>
                <div className='h-full rounded-full bg-primary transition-[width] duration-200' style={{ width: `${levelFraction(st?.volume ?? null) * 100}%` }} />
                {st && <div className='absolute -top-1 h-4 w-0.5 rounded bg-red-600' style={{ left: `${levelFraction(st.maxVolume) * 100}%` }} title='Потолок громкости' />}
              </div>
              <Button
                className={cn('h-14 w-full rounded-2xl text-base font-semibold', muteOn ? 'bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500' : 'border-red-600/50 text-red-700 dark:text-red-300')}
                variant={muteOn ? 'default' : 'outline'}
                aria-pressed={muteOn}
                disabled={disabled || pending === 'MUON' || pending === 'MUOFF'}
                onClick={() => {
                  buzz()
                  void send(muteOn ? 'MUOFF' : 'MUON')
                }}
              >
                {pending === 'MUON' || pending === 'MUOFF' ? <Loader2 className='animate-spin' /> : <VolumeX />} {muteOn ? 'Звук выключен' : 'Mute'}
              </Button>
            </CardContent>
          </Card>

          {/* Входы */}
          <section aria-label='Входы' className='space-y-2'>
            <h2 className='text-sm font-medium'>Входы</h2>
            {inputs.length === 0 && on && <p className='text-xs text-muted-foreground'>Список входов недоступен.</p>}
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
              {inputs.map((i) => {
                const active = curInput === i.code
                const busy = pending === `SI${i.code}`
                return (
                  <Button
                    key={i.code}
                    variant={active ? 'default' : 'outline'}
                    className={cn('h-16 justify-start gap-2 rounded-2xl px-3 text-base', active && 'bg-sky-700 text-white hover:bg-sky-800 dark:bg-sky-600 dark:hover:bg-sky-500')}
                    aria-pressed={active}
                    disabled={disabled || pending !== null}
                    onClick={() => {
                      buzz()
                      void send(`SI${i.code}`)
                    }}
                    style={touch}
                  >
                    {busy ? <Loader2 className='animate-spin' /> : <span className='text-xl' aria-hidden>{inputIcon(i.name)}</span>}
                    <span className='truncate'>{i.name}</span>
                  </Button>
                )
              })}
            </div>
          </section>

          {/* Режимы звука */}
          <section aria-label='Режимы звука' className='space-y-2'>
            <h2 className='text-sm font-medium'>Режим звука</h2>
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-5'>
              {MODES.map((m) => {
                const active = curMode === m.cmd
                return (
                  <Button
                    key={m.cmd}
                    variant='outline'
                    className={cn('h-14 rounded-2xl border-2 text-base font-semibold', active ? m.on : m.off)}
                    aria-pressed={active}
                    disabled={disabled || pending !== null}
                    onClick={async () => {
                      buzz()
                      const r = await send(m.cmd)
                      if (r?.accepted) setLastMode({ cmd: m.cmd, modeAtClick: r.state?.mode ?? null })
                    }}
                    style={touch}
                  >
                    {pending === m.cmd ? <Loader2 className='animate-spin' /> : m.label}
                  </Button>
                )
              })}
            </div>
            {st?.mode && <p className='text-xs text-muted-foreground'>Сейчас: {st.mode}</p>}
          </section>

          {/* Быстрый выбор */}
          <section aria-label='Быстрый выбор' className='space-y-2'>
            <h2 className='text-sm font-medium'>Быстрый выбор</h2>
            <div className='grid grid-cols-3 gap-2'>
              {[1, 2, 3].map((n) => {
                const cmd = `MSQUICK${n}`
                const active = lastQuick === cmd
                return (
                  <Button
                    key={n}
                    variant={active ? 'default' : 'outline'}
                    className='h-12 rounded-xl'
                    aria-pressed={active}
                    disabled={disabled || pending !== null}
                    onClick={async () => {
                      buzz()
                      const r = await send(cmd)
                      if (r?.accepted) setLastQuick(cmd)
                    }}
                    style={touch}
                  >
                    {pending === cmd ? <Loader2 className='animate-spin' /> : `Быстрый ${n}`}
                  </Button>
                )
              })}
            </div>
            <p className='text-xs text-muted-foreground'>Ресивер не сообщает, какой быстрый выбор активен, подсвечен последний нажатый.</p>
          </section>

          {/* Навигация */}
          <section aria-label='Навигация по меню' className='space-y-3'>
            <h2 className='text-sm font-medium'>Меню</h2>
            <div className='flex items-center justify-center gap-4'>
              <div className='grid size-56 shrink-0 grid-cols-3 grid-rows-3 place-items-center rounded-full border bg-muted/50 p-2 sm:size-64'>
                <span />
                <Button variant='ghost' className='size-16 rounded-full' aria-label='Вверх' disabled={disabled} {...holdUp} style={touch}>
                  <ChevronUp className='size-8' />
                </Button>
                <span />
                <Button variant='ghost' className='size-16 rounded-full' aria-label='Влево' disabled={disabled} {...holdLeft} style={touch}>
                  <ChevronLeft className='size-8' />
                </Button>
                <Button
                  className='size-16 rounded-full text-base font-bold'
                  aria-label='OK'
                  disabled={disabled}
                  onClick={() => {
                    buzz()
                    void send('MNENT', { quiet: true })
                  }}
                  style={touch}
                >
                  OK
                </Button>
                <Button variant='ghost' className='size-16 rounded-full' aria-label='Вправо' disabled={disabled} {...holdRight} style={touch}>
                  <ChevronRight className='size-8' />
                </Button>
                <span />
                <Button variant='ghost' className='size-16 rounded-full' aria-label='Вниз' disabled={disabled} {...holdDown} style={touch}>
                  <ChevronDown className='size-8' />
                </Button>
                <span />
              </div>
              <div className='flex flex-col gap-2'>
                {[
                  { label: 'Назад', icon: <Undo2 />, run: () => send('MNRTN', { quiet: true }) },
                  {
                    label: menuOpen ? 'Закрыть' : 'Меню',
                    icon: <Menu />,
                    run: async () => {
                      const r = await send(menuOpen ? 'MNMEN OFF' : 'MNMEN ON', { quiet: true })
                      if (r) setMenuOpen(!menuOpen)
                    },
                  },
                  { label: 'Инфо', icon: <Info />, run: () => send('MNINF', { quiet: true }) },
                  { label: 'Опции', icon: <Settings2 />, run: () => send('MNOPT', { quiet: true }) },
                ].map((b) => (
                  <Button
                    key={b.label}
                    variant='outline'
                    className='h-12 w-28 justify-start gap-2 rounded-xl'
                    disabled={disabled}
                    onClick={() => {
                      buzz()
                      void b.run()
                    }}
                    style={touch}
                  >
                    {b.icon} {b.label}
                  </Button>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* Звук и ссылки */}
        <Collapsible open={soundOpen} onOpenChange={setSoundOpen}>
          <CollapsibleTrigger asChild>
            <Button variant='outline' className='h-12 w-full justify-between rounded-xl'>
              Звук и настройки ресивера <ChevronDown className={cn('transition-transform', soundOpen && 'rotate-180')} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className='mt-3 space-y-4'>
            <Card>
              <CardContent className='space-y-4'>
                <ReceiverControls online />
                <div className='space-y-2'>
                  <div className='text-xs font-medium'>Настройки ресивера</div>
                  {RECEIVER_LINK_GROUPS.map((g) => (
                    <div key={g.title} className='flex flex-wrap items-center gap-1'>
                      <span className='w-full text-[11px] text-muted-foreground sm:w-auto sm:pr-1'>{g.title}:</span>
                      {g.links.map((l) => (
                        <HomeLink key={l.path} service='marantz' path={l.path} rel='noopener noreferrer' className='inline-flex items-center gap-1 rounded border px-2 py-1.5 text-xs hover:bg-muted'>
                          {l.label} <ExternalLink className='size-3' />
                        </HomeLink>
                      ))}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title='Выключить ресивер?'
        desc='Ресивер перейдёт в режим ожидания. Включить его можно кнопкой питания здесь или на самом ресивере.'
        confirmText='Выключить'
        destructive
        handleConfirm={() => {
          setConfirmOff(false)
          void send('PWSTANDBY')
        }}
      />
    </Page>
  )
}
