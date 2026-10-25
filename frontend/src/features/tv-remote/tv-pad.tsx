import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FastForward, LogIn, Pause, Play, Power, Rewind, Square, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { commandTitle, isCustom, type RemoteConfig } from '@/lib/receiver-pad'
import { isTvRepeatable, tvKeyStatus, type TvStatus } from '@/lib/tv-pad'
import { BasePadKey, Cap } from '@/features/receiver/pad-key'

// Экранная копия пульта Samsung AA59-00602A: подписи как на кнопках оригинала, ключ каждой кнопки приходит с сервера (привязки tv.remote).
type KeyProps = {
  id: string
  label: string
  cfg: RemoteConfig | undefined
  st: TvStatus | undefined
  configure: boolean
  onPress: (id: string, cmd: string) => void
  onPick: (id: string) => void
  className?: string
  children: React.ReactNode
}

function TvKey({ cfg, st, ...p }: KeyProps) {
  const cmd = cfg ? (cfg.bindings[p.id] ?? null) : null
  return <BasePadKey {...p} cmd={cmd} status={tvKeyStatus(cmd, st)} custom={cfg ? isCustom(cfg, p.id) : false} cmdTitle={cfg ? commandTitle(cfg, cmd) : '…'} repeatable={isTvRepeatable(cmd)} />
}

type PadProps = { st: TvStatus | undefined; cfg: RemoteConfig | undefined; configure: boolean; onPress: (id: string, cmd: string) => void; onPick: (id: string) => void }

const COLORS: [string, string, string][] = [
  ['color-a', 'A', 'bg-red-600 from-red-500 to-red-700'],
  ['color-b', 'B', 'bg-green-600 from-green-500 to-green-700'],
  ['color-c', 'C', 'bg-yellow-400 from-yellow-300 to-yellow-500 text-zinc-900'],
  ['color-d', 'D', 'bg-blue-600 from-blue-500 to-blue-700'],
]

export function TvPad({ st, cfg, configure, onPress, onPick }: PadProps) {
  const c = { cfg, st, configure, onPress, onPick }
  const pill = 'h-9 rounded-full text-[10px]'
  const big = 'h-14 rounded-xl text-sm'
  return (
    <div data-remote='AA59-00602A' className='mx-auto w-full max-w-[360px] select-none rounded-[2.25rem] border border-zinc-700 bg-gradient-to-b from-zinc-900 to-black p-5 pb-6 text-zinc-100 shadow-[0_20px_40px_-12px_rgba(0,0,0,.8),inset_0_1px_0_rgba(255,255,255,.08)]'>
      {/* а) POWER, SOURCE */}
      <div className='flex items-center justify-between'>
        <TvKey id='power' label='POWER' {...c} className='size-12 rounded-full from-red-500 to-red-800 text-white'>
          <Power className='size-6' aria-hidden />
        </TvKey>
        <TvKey id='source' label='SOURCE' {...c} className='h-9 w-24 rounded-full text-[10px]'>
          SOURCE
        </TvKey>
      </div>

      {/* б) цифры */}
      <div className='mt-5 grid grid-cols-3 gap-2'>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <TvKey key={n} id={`num-${n}`} label={String(n)} {...c} className='h-11 rounded-md text-base'>
            {n}
          </TvKey>
        ))}
        <TvKey id='ttx' label='TTX/MIX' {...c} className='h-11 rounded-md text-[10px]'>
          TTX/MIX
        </TvKey>
        <TvKey id='num-0' label='0' {...c} className='h-11 rounded-md text-base'>
          0
        </TvKey>
        <TvKey id='prech' label='PRE-CH' {...c} className='h-11 rounded-md text-[10px]'>
          PRE-CH
        </TvKey>
      </div>

      {/* в) VOL, MUTE/CH LIST, P */}
      <div className='mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3'>
        <div>
          <Cap>Vol</Cap>
          <div className='flex flex-col gap-2'>
            <TvKey id='vol-up' label='VOL +' {...c} className={big}>
              <Volume2 className='size-5' aria-hidden />
              <span className='ml-1 text-lg leading-none'>+</span>
            </TvKey>
            <TvKey id='vol-down' label='VOL −' {...c} className={big}>
              <Volume2 className='size-4' aria-hidden />
              <span className='ml-1 text-lg leading-none'>−</span>
            </TvKey>
          </div>
        </div>
        <div className='flex flex-col items-center gap-3'>
          <TvKey id='mute' label='MUTE' {...c} className='size-11 rounded-full'>
            <VolumeX className='size-5' aria-hidden />
          </TvKey>
          <TvKey id='ch-list' label='CH LIST' {...c} className='h-9 w-[4.5rem] rounded-full text-[9px]'>
            CH LIST
          </TvKey>
        </div>
        <div>
          <Cap>P</Cap>
          <div className='flex flex-col gap-2'>
            <TvKey id='p-up' label='P ▲' {...c} className={big}>
              <ChevronUp className='size-6' aria-hidden />
            </TvKey>
            <TvKey id='p-down' label='P ▼' {...c} className={big}>
              <ChevronDown className='size-6' aria-hidden />
            </TvKey>
          </div>
        </div>
      </div>

      {/* г) CONTENT, MENU, GUIDE */}
      <div className='mt-5 grid grid-cols-3 gap-2'>
        <TvKey id='content' label='CONTENT' {...c} className={pill}>
          CONTENT
        </TvKey>
        <TvKey id='menu' label='MENU' {...c} className={pill}>
          MENU
        </TvKey>
        <TvKey id='guide' label='GUIDE' {...c} className={pill}>
          GUIDE
        </TvKey>
      </div>

      {/* д) TOOLS, INFO */}
      <div className='mt-3 grid grid-cols-2 gap-6 px-6'>
        <TvKey id='tools' label='TOOLS' {...c} className={pill}>
          TOOLS
        </TvKey>
        <TvKey id='info' label='INFO' {...c} className={pill}>
          INFO
        </TvKey>
      </div>

      {/* е) навигация */}
      <div className='mt-4 flex justify-center'>
        <div className='grid size-52 grid-cols-3 grid-rows-3 place-items-center rounded-full bg-gradient-to-b from-zinc-800 to-zinc-950 p-2 shadow-[inset_0_2px_8px_rgba(0,0,0,.8),0_1px_0_rgba(255,255,255,.08)]'>
          <span />
          <TvKey id='nav-up' label='Вверх' {...c} className='size-12 rounded-full'>
            <ChevronUp className='size-6' aria-hidden />
          </TvKey>
          <span />
          <TvKey id='nav-left' label='Влево' {...c} className='size-12 rounded-full'>
            <ChevronLeft className='size-6' aria-hidden />
          </TvKey>
          <TvKey id='enter' label='ENTER (источник)' {...c} className='size-14 rounded-full border border-zinc-500'>
            <LogIn className='size-6' aria-hidden />
          </TvKey>
          <TvKey id='nav-right' label='Вправо' {...c} className='size-12 rounded-full'>
            <ChevronRight className='size-6' aria-hidden />
          </TvKey>
          <span />
          <TvKey id='nav-down' label='Вниз' {...c} className='size-12 rounded-full'>
            <ChevronDown className='size-6' aria-hidden />
          </TvKey>
          <span />
        </div>
      </div>

      {/* ж) RETURN, EXIT */}
      <div className='mt-4 grid grid-cols-2 gap-6 px-4'>
        <TvKey id='return' label='RETURN' {...c} className={pill}>
          RETURN
        </TvKey>
        <TvKey id='exit' label='EXIT' {...c} className={pill}>
          EXIT
        </TvKey>
      </div>

      {/* з) цветные A B C D */}
      <div className='mt-4 grid grid-cols-4 gap-2'>
        {COLORS.map(([id, label, cls]) => (
          <TvKey key={id} id={id} label={label} {...c} className={cn('h-9 rounded-md text-xs', cls)}>
            {label}
          </TvKey>
        ))}
      </div>

      {/* и) E-MANUAL, P.SIZE, AD/SUBT., STOP */}
      <div className='mt-3 grid grid-cols-4 gap-2'>
        <TvKey id='emanual' label='E-MANUAL' {...c} className='h-10 rounded-md text-[8px]'>
          E-MANUAL
        </TvKey>
        <TvKey id='psize' label='P.SIZE' {...c} className='h-10 rounded-md text-[9px]'>
          P.SIZE
        </TvKey>
        <TvKey id='ad' label='AD/SUBT.' {...c} className='h-10 rounded-md text-[9px]'>
          AD/SUBT.
        </TvKey>
        <TvKey id='stop' label='STOP' {...c} className='h-10 rounded-md'>
          <Square className='size-4' aria-hidden />
        </TvKey>
      </div>

      {/* к) воспроизведение */}
      <div className='mt-3 grid grid-cols-4 gap-2'>
        <TvKey id='rew' label='Назад (⏪)' {...c} className='h-10 rounded-md'>
          <Rewind className='size-4' aria-hidden />
        </TvKey>
        <TvKey id='play' label='Воспроизведение (▶)' {...c} className='h-10 rounded-md'>
          <Play className='size-4' aria-hidden />
        </TvKey>
        <TvKey id='pause' label='Пауза (⏸)' {...c} className='h-10 rounded-md'>
          <Pause className='size-4' aria-hidden />
        </TvKey>
        <TvKey id='ff' label='Вперёд (⏩)' {...c} className='h-10 rounded-md'>
          <FastForward className='size-4' aria-hidden />
        </TvKey>
      </div>

      <div className='mt-6 text-center text-[10px] tracking-[0.2em] text-zinc-500'>AA59-00602A</div>
    </div>
  )
}
