import { useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Info, Loader2, Menu, Minus, Plus, Power, Settings2, Undo2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { activeInput, activeMode, bumpVolume, formatDb, inputIcon, levelFraction } from '@/lib/receiver-remote'
import { type Block, SortableBlocks } from '@/components/sortable-blocks'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ReceiverControls } from '@/features/media/receiver-controls'
import { ReceiverSettingsLinks } from '@/features/media/receiver-settings-links'
import { buzz, useHoldButton } from './use-hold'
import { errInfo, useReceiver } from './use-receiver'
import { RemoteTab } from './remote-tab'

// Смысловые цвета: активное — залитое (белый текст на тёмном фоне ≥ 4,5:1), неактивное — контур
const MODES = [
  { cmd: 'MSMOVIE', label: 'Movie', on: 'bg-blue-700 text-white border-blue-700 dark:bg-blue-600 dark:border-blue-600', off: 'text-blue-700 border-blue-700/40 dark:text-blue-300 dark:border-blue-300/40' },
  { cmd: 'MSMUSIC', label: 'Music', on: 'bg-violet-700 text-white border-violet-700 dark:bg-violet-600 dark:border-violet-600', off: 'text-violet-700 border-violet-700/40 dark:text-violet-300 dark:border-violet-300/40' },
  { cmd: 'MSGAME', label: 'Game', on: 'bg-orange-700 text-white border-orange-700 dark:bg-orange-600 dark:border-orange-600', off: 'text-orange-700 border-orange-700/40 dark:text-orange-300 dark:border-orange-300/40' },
  { cmd: 'MSDIRECT', label: 'Direct', on: 'bg-teal-700 text-white border-teal-700 dark:bg-teal-600 dark:border-teal-600', off: 'text-teal-700 border-teal-700/40 dark:text-teal-300 dark:border-teal-300/40' },
  { cmd: 'MSSTEREO', label: 'Stereo', on: 'bg-pink-700 text-white border-pink-700 dark:bg-pink-600 dark:border-pink-600', off: 'text-pink-700 border-pink-700/40 dark:text-pink-300 dark:border-pink-300/40' },
]

const touch = { touchAction: 'manipulation' } as const

const Title = ({ children }: { children: React.ReactNode }) => <h2 className='text-sm font-medium'>{children}</h2>

export function ReceiverSection({ view }: { view: 'control' | 'remote' }) {
  const { q, pending, send, patch } = useReceiver()
  const st = q.data
  const err = q.isError ? errInfo(q.error) : null
  const on = st?.power === 'ON'
  const standby = st?.power === 'STANDBY'
  const powerLabel = on ? 'Выключить ресивер' : standby ? 'Включить ресивер' : 'Питание ресивера'
  const [lastQuick, setLastQuick] = useState<string | null>(null)
  const [lastMode, setLastMode] = useState<{ cmd: string; modeAtClick: string | null } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

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

  // Блоки страницы: порядок по умолчанию — как здесь; сохранённый порядок применяет SortableBlocks (layout.receiver).
  // Шесть блоков управления — кирпичики одной высоты (grid, общий min-height); ссылки — на всю ширину под ними.
  const dim = cn('transition-opacity', disabled && 'pointer-events-none opacity-50')
  const brick = 'md:min-h-[26rem]'
  const card = 'h-full gap-3 pb-5 pt-7'
  const body = 'flex flex-1 flex-col gap-3'
  const blocks: Block[] = [
    {
      id: 'volume',
      title: 'Громкость',
      className: brick,
      node: (
        <Card className={cn(card, dim)} aria-disabled={disabled}>
          <CardContent className={body}>
            <Title>Громкость</Title>
            <div className='flex flex-1 items-stretch justify-between gap-3'>
              <Button variant='outline' className='h-full min-h-16 w-16 shrink-0 rounded-2xl' aria-label='Тише' disabled={disabled} {...downHold} style={touch}>
                <Minus className='size-8' />
              </Button>
              <div className='flex min-w-0 flex-col items-center justify-center text-center'>
                <div className='whitespace-nowrap text-2xl font-bold tabular-nums' aria-live='polite'>
                  {formatDb(st?.volume ?? null)}
                </div>
                <div className='text-xs text-muted-foreground'>громкость</div>
              </div>
              <Button variant='outline' className='h-full min-h-16 w-16 shrink-0 rounded-2xl' aria-label='Громче' disabled={disabled} {...upHold} style={touch}>
                <Plus className='size-8' />
              </Button>
            </div>
            <div className='relative h-2 shrink-0 rounded-full bg-muted' role='img' aria-label={`Уровень ${formatDb(st?.volume ?? null)}, потолок ${formatDb(st?.maxVolume ?? null)}`}>
              <div className='h-full rounded-full bg-primary transition-[width] duration-200' style={{ width: `${levelFraction(st?.volume ?? null) * 100}%` }} />
              {st && <div className='absolute -top-1 h-4 w-0.5 rounded bg-red-600' style={{ left: `${levelFraction(st.maxVolume) * 100}%` }} title='Потолок громкости' />}
            </div>
            <Button
              className={cn('h-14 w-full shrink-0 rounded-2xl text-base font-semibold', muteOn ? 'bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500' : 'border-red-600/50 text-red-700 dark:text-red-300')}
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
      ),
    },
    {
      id: 'inputs',
      title: 'Входы',
      className: brick,
      node: (
        <Card className={cn(card, dim)} aria-disabled={disabled}>
          <CardContent className={body}>
            <Title>Входы</Title>
            {inputs.length === 0 && on && <p className='text-xs text-muted-foreground'>Список входов недоступен.</p>}
            <div className='grid flex-1 auto-rows-fr grid-cols-2 gap-2'>
              {inputs.map((i) => {
                const active = curInput === i.code
                const busy = pending === `SI${i.code}`
                return (
                  <Button
                    key={i.code}
                    variant={active ? 'default' : 'outline'}
                    className={cn('h-full min-h-12 min-w-0 justify-start gap-1.5 rounded-2xl px-2 text-sm', active && 'bg-sky-700 text-white hover:bg-sky-800 dark:bg-sky-600 dark:hover:bg-sky-500')}
                    aria-pressed={active}
                    disabled={disabled || pending !== null}
                    onClick={() => {
                      buzz()
                      void send(`SI${i.code}`)
                    }}
                    style={touch}
                  >
                    {busy ? <Loader2 className='animate-spin' /> : <span className='shrink-0 text-lg' aria-hidden>{inputIcon(i.name)}</span>}
                    <span className='truncate'>{i.name}</span>
                  </Button>
                )
              })}
            </div>
          </CardContent>
        </Card>
      ),
    },
    {
      id: 'modes',
      title: 'Режимы звука',
      className: brick,
      node: (
        <Card className={cn(card, dim)} aria-disabled={disabled}>
          <CardContent className={body}>
            <Title>Режим звука</Title>
            <div className='grid flex-1 auto-rows-fr grid-cols-2 gap-2'>
              {MODES.map((m, idx) => {
                const active = curMode === m.cmd
                return (
                  <Button
                    key={m.cmd}
                    variant='outline'
                    className={cn('h-full min-h-12 rounded-2xl border-2 text-base font-semibold', idx === MODES.length - 1 && MODES.length % 2 === 1 && 'col-span-2', active ? m.on : m.off)}
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
            <p className='text-xs text-muted-foreground'>{st?.mode ? `Сейчас: ${st.mode}` : ' '}</p>
          </CardContent>
        </Card>
      ),
    },
    {
      id: 'quick',
      title: 'Быстрый выбор',
      className: brick,
      node: (
        <Card className={cn(card, dim)} aria-disabled={disabled}>
          <CardContent className={body}>
            <Title>Быстрый выбор</Title>
            <div className='grid flex-1 auto-rows-fr grid-cols-1 gap-2'>
              {[1, 2, 3].map((n) => {
                const cmd = `MSQUICK${n}`
                const active = lastQuick === cmd
                return (
                  <Button
                    key={n}
                    variant={active ? 'default' : 'outline'}
                    className='h-full min-h-12 rounded-2xl text-base'
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
          </CardContent>
        </Card>
      ),
    },
    {
      id: 'nav',
      title: 'Навигация',
      className: brick,
      node: (
        <Card className={card}>
          <CardContent className={body}>
            <div className='flex items-start justify-between gap-3'>
              <div className='min-w-0'>
                <Title>Меню</Title>
                {st?.power === 'STANDBY' && <p className='text-xs text-muted-foreground'>Ресивер выключен</p>}
              </div>
              <Button
                size='icon'
                aria-label={powerLabel}
                title={powerLabel}
                aria-pressed={on}
                disabled={(!on && !standby) || pending !== null}
                className={cn(
                  'size-12 shrink-0 rounded-full',
                  // зелёная — включён; красная (как активный Mute) — только подтверждённый standby; нет данных — серая
                  on && 'bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500',
                  standby && 'bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500',
                  !on && !standby && 'bg-muted text-muted-foreground hover:bg-muted/80',
                )}
                onClick={() => {
                  buzz()
                  void send(on ? 'PWSTANDBY' : 'PWON')
                }}
              >
                {pending === 'PWON' || pending === 'PWSTANDBY' ? <Loader2 className='size-6 animate-spin' /> : <Power className='size-6' />}
              </Button>
            </div>
            <div className={cn('flex flex-1 flex-col justify-between gap-3', dim)} aria-disabled={disabled}>
              <div className='flex flex-1 items-center justify-center'>
                <div className='grid size-48 shrink-0 grid-cols-3 grid-rows-3 place-items-center rounded-full border bg-muted/50 p-1'>
                  <span />
                  <Button variant='ghost' className='size-14 rounded-full' aria-label='Вверх' disabled={disabled} {...holdUp} style={touch}>
                    <ChevronUp className='size-7' />
                  </Button>
                  <span />
                  <Button variant='ghost' className='size-14 rounded-full' aria-label='Влево' disabled={disabled} {...holdLeft} style={touch}>
                    <ChevronLeft className='size-7' />
                  </Button>
                  <Button
                    className='size-14 rounded-full text-base font-bold'
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
                  <Button variant='ghost' className='size-14 rounded-full' aria-label='Вправо' disabled={disabled} {...holdRight} style={touch}>
                    <ChevronRight className='size-7' />
                  </Button>
                  <span />
                  <Button variant='ghost' className='size-14 rounded-full' aria-label='Вниз' disabled={disabled} {...holdDown} style={touch}>
                    <ChevronDown className='size-7' />
                  </Button>
                  <span />
                </div>
              </div>
              <div className='grid grid-cols-4 gap-2'>
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
                    className='h-14 min-w-0 flex-col gap-0.5 rounded-xl px-1 text-[11px]'
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
          </CardContent>
        </Card>
      ),
    },
    {
      id: 'sound',
      title: 'Звук и настройки',
      className: brick,
      node: (
        <Card className={card}>
          <CardContent className={body}>
            <Title>Звук и настройки</Title>
            <div className='flex flex-1 flex-col justify-center'>
              <ReceiverControls online />
            </div>
          </CardContent>
        </Card>
      ),
    },
    {
      id: 'links',
      title: 'Настройки ресивера (ссылки)',
      className: 'col-span-full',
      node: (
        <Card>
          <CardContent>
            <ReceiverSettingsLinks />
          </CardContent>
        </Card>
      ),
    },
  ]

  const header = (
    <div>
      <div className='flex items-center gap-2 text-sm' role='status'>
        <span>Marantz NR1604</span>
        <span className='text-muted-foreground' aria-hidden>
          ·
        </span>
        <span className='inline-flex items-center gap-1.5'>
          <span className={cn('inline-block size-2 rounded-full', connection.cls)} aria-hidden /> {connection.label}
          {st?.power === 'STANDBY' && ' · выключен'}
        </span>
      </div>
      {err && <p className='mt-1 text-xs text-destructive'>{err.message}</p>}
    </div>
  )

  // Страница-контейнер «Универсальный пульт» (features/media-hub) ставит Page и вкладки; здесь — содержимое вкладок «Ресивер» и «Пульт ресивера»
  return (
    <div className='space-y-4'>
      {header}
      <div className='pb-[env(safe-area-inset-bottom)]' style={touch}>
        {view === 'control' ? <SortableBlocks grid stable blocks={blocks} className='grid gap-4 md:grid-cols-2 xl:grid-cols-3' /> : <RemoteTab st={st} send={send} patch={patch} />}
      </div>
    </div>
  )
}
