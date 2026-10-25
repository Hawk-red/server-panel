import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Heart, Leaf, Play, Power, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { activeInput, type ReceiverFullState } from '@/lib/receiver-remote'
import { commandTitle, isCustom, isRepeatable, keyStatus, liveInputName, type RemoteConfig } from '@/lib/receiver-pad'
import { BasePadKey, Cap } from './pad-key'

// Экранная копия пульта Marantz RC042SR. Подписи — как на кнопках оригинала; команда каждой кнопки приходит с сервера (привязки).
type KeyProps = {
  id: string
  label: string
  cfg: RemoteConfig | undefined
  st: ReceiverFullState | undefined
  configure: boolean
  onPress: (id: string, cmd: string) => void
  onPick: (id: string) => void
  className?: string
  active?: boolean
  children: React.ReactNode
}

function PadKey({ cfg, st, ...p }: KeyProps) {
  const cmd = cfg ? (cfg.bindings[p.id] ?? null) : null
  return <BasePadKey {...p} cmd={cmd} status={keyStatus(cmd, st)} custom={cfg ? isCustom(cfg, p.id) : false} cmdTitle={cfg ? commandTitle(cfg, cmd) : '…'} repeatable={isRepeatable(cmd)} />
}

type PadProps = {
  st: ReceiverFullState | undefined
  cfg: RemoteConfig | undefined
  configure: boolean
  onPress: (id: string, cmd: string) => void
  onPick: (id: string) => void
}

const INPUT_ROWS: { id: string; label: string; icon?: React.ReactNode }[][] = [
  [{ id: 'in-cblsat', label: 'CBL/SAT' }, { id: 'in-dvd', label: 'DVD' }, { id: 'in-bd', label: 'Blu-ray' }],
  [{ id: 'in-game', label: 'GAME' }, { id: 'in-aux', label: 'AUX' }, { id: 'in-mplay', label: 'MEDIA PLAYER' }],
  [{ id: 'in-tv', label: 'TV AUDIO' }, { id: 'in-8k', label: '8K' }, { id: 'in-tuner', label: 'TUNER' }],
  [{ id: 'in-usb', label: 'USB' }, { id: 'in-cd', label: 'CD' }, { id: 'in-bt', label: 'Bluetooth' }],
  [{ id: 'in-heos', label: 'HEOS', icon: <Heart className='size-4' aria-hidden /> }, { id: 'in-phono', label: 'PHONO' }, { id: 'in-iradio', label: 'INTERNET RADIO' }],
]

export function RemotePad({ st, cfg, configure, onPress, onPick }: PadProps) {
  const common = { cfg, st, configure, onPress, onPick }
  const curInput = st ? activeInput(st, st.inputs) : null
  const modeIs = (m: string) => st?.mode === m
  const cmdOf = (id: string) => cfg?.bindings[id] ?? null
  const flat = 'rounded-md px-1 py-2 text-[10px]'
  const big = 'h-14 rounded-xl text-sm'
  const sound = (id: string, label: string, color: string, mode: string) => (
    <PadKey key={id} id={id} label={label} {...common} active={modeIs(mode)} className={cn('h-11 rounded-md border-b-[3px] text-[10px]', color)}>
      {label}
    </PadKey>
  )
  return (
    <div
      data-remote='RC042SR'
      className='mx-auto w-full max-w-[420px] select-none rounded-[2.25rem] border border-zinc-700 bg-gradient-to-b from-zinc-900 to-black p-5 pb-6 text-zinc-100 shadow-[0_20px_40px_-12px_rgba(0,0,0,.8),inset_0_1px_0_rgba(255,255,255,.08)]'
    >
      {/* 1. ZONE SELECT, SLEEP, POWER */}
      <div className='flex items-end justify-between gap-3'>
        <div className='flex-1'>
          <Cap>Zone select</Cap>
          <div className='grid grid-cols-2 gap-2'>
            <PadKey id='zone-main' label='MAIN' {...common} className={flat}>MAIN</PadKey>
            <PadKey id='zone-2' label='ZONE 2' {...common} className={flat}>ZONE 2</PadKey>
          </div>
        </div>
        <div className='w-16'>
          <Cap>&nbsp;</Cap>
          <PadKey id='sleep' label='SLEEP' {...common} className={flat}>SLEEP</PadKey>
        </div>
        <PadKey id='power' label='POWER' {...common} active={st?.power === 'ON'} className='size-12 shrink-0 rounded-full from-red-500 to-red-800 text-white'>
          <Power className='size-6' aria-hidden />
        </PadKey>
      </div>

      {/* 2. входы */}
      <div className='mt-5 grid grid-cols-3 gap-2'>
        {INPUT_ROWS.flat().map((b) => {
          const name = liveInputName(cmdOf(b.id), st)
          return (
            <PadKey key={b.id} id={b.id} label={b.label} {...common} active={cmdOf(b.id) !== null && cmdOf(b.id) === (curInput ? `SI${curInput}` : null)} className='h-12 flex-col gap-0.5 rounded-md px-1 text-[10px]'>
              <span className='flex items-center gap-1'>
                {b.icon}
                <span className='truncate'>{b.label}</span>
              </span>
              {name && name.toLowerCase() !== b.label.toLowerCase() && <span className='max-w-full truncate text-[9px] font-normal normal-case tracking-normal text-zinc-400'>{name}</span>}
            </PadKey>
          )
        })}
      </div>

      {/* 3. CH/PAGE, ECO, MUTE, VOLUME */}
      <div className='mt-5 grid grid-cols-[1fr_auto_auto_1fr] items-center gap-3'>
        <div>
          <Cap>Ch/Page</Cap>
          <div className='flex flex-col gap-2'>
            <PadKey id='ch-up' label='CH/PAGE вверх' {...common} className={big}><ChevronUp className='size-6' aria-hidden /></PadKey>
            <PadKey id='ch-down' label='CH/PAGE вниз' {...common} className={big}><ChevronDown className='size-6' aria-hidden /></PadKey>
          </div>
        </div>
        <PadKey id='eco' label='ECO' {...common} className='size-12 rounded-full from-emerald-500 to-emerald-800 text-white'>
          <Leaf className='size-6' aria-hidden />
        </PadKey>
        <PadKey id='mute' label='MUTE' {...common} active={st?.mute === true} className={cn('size-12 rounded-full', st?.mute === true && 'from-red-600 to-red-900')}>
          <VolumeX className='size-6' aria-hidden />
        </PadKey>
        <div>
          <Cap>Volume</Cap>
          <div className='flex flex-col gap-2'>
            <PadKey id='vol-up' label='VOLUME громче' {...common} className={big}><Volume2 className='size-6' aria-hidden /><span className='ml-1 text-lg leading-none'>+</span></PadKey>
            <PadKey id='vol-down' label='VOLUME тише' {...common} className={big}><Volume2 className='size-5' aria-hidden /><span className='ml-1 text-lg leading-none'>−</span></PadKey>
          </div>
        </div>
      </div>

      {/* 4. INFO, OPTION */}
      <div className='mt-5 grid grid-cols-2 gap-6 px-2'>
        <PadKey id='info' label='INFO' {...common} className='h-10 rounded-full text-xs'>INFO</PadKey>
        <PadKey id='option' label='OPTION' {...common} className='h-10 rounded-full text-xs'>OPTION</PadKey>
      </div>

      {/* 5. навигация */}
      <div className='mt-5 flex justify-center'>
        <div className='grid size-56 grid-cols-3 grid-rows-3 place-items-center rounded-full bg-gradient-to-b from-zinc-800 to-zinc-950 p-2 shadow-[inset_0_2px_8px_rgba(0,0,0,.8),0_1px_0_rgba(255,255,255,.08)]'>
          <span />
          <PadKey id='nav-up' label='Вверх' {...common} className='size-14 rounded-full'><ChevronUp className='size-7' aria-hidden /></PadKey>
          <span />
          <PadKey id='nav-left' label='Влево' {...common} className='size-14 rounded-full'><ChevronLeft className='size-7' aria-hidden /></PadKey>
          <PadKey id='enter' label='ENTER' {...common} className='size-16 rounded-full border border-zinc-500 text-[10px]'>ENTER</PadKey>
          <PadKey id='nav-right' label='Вправо' {...common} className='size-14 rounded-full'><ChevronRight className='size-7' aria-hidden /></PadKey>
          <span />
          <PadKey id='nav-down' label='Вниз' {...common} className='size-14 rounded-full'><ChevronDown className='size-7' aria-hidden /></PadKey>
          <span />
        </div>
      </div>

      {/* 6. BACK, SETUP */}
      <div className='mt-5 grid grid-cols-2 gap-6 px-2'>
        <PadKey id='back' label='BACK' {...common} className='h-10 rounded-full text-xs'>BACK</PadKey>
        <PadKey id='setup' label='SETUP' {...common} className='h-10 rounded-full text-xs'>SETUP</PadKey>
      </div>

      {/* 7. TUNE, воспроизведение */}
      <div className='mt-5 grid grid-cols-3 gap-3'>
        <PadKey id='tune-down' label='TUNE −' {...common} className='h-11 flex-col gap-0.5 rounded-md text-[9px]'><SkipBack className='size-4' aria-hidden />TUNE −</PadKey>
        <PadKey id='play' label='▶/II' {...common} className='h-11 rounded-md text-[10px]'><Play className='size-4' aria-hidden /><span className='ml-0.5'>/II</span></PadKey>
        <PadKey id='tune-up' label='TUNE +' {...common} className='h-11 flex-col gap-0.5 rounded-md text-[9px]'><SkipForward className='size-4' aria-hidden />TUNE +</PadKey>
      </div>

      {/* 8. SMART SELECT */}
      <div className='mt-5'>
        <Cap>Smart select</Cap>
        <div className='grid grid-cols-4 gap-2'>
          {[1, 2, 3, 4].map((n) => (
            <PadKey key={n} id={`ss-${n}`} label={`SMART SELECT ${n}`} {...common} className='h-10 rounded-md text-sm'>{n}</PadKey>
          ))}
        </div>
      </div>

      {/* 9. SOUND MODE */}
      <div className='mt-5'>
        <Cap>Sound mode</Cap>
        <div className='grid grid-cols-4 gap-2'>
          {sound('sm-movie', 'MOVIE', 'border-emerald-500', 'MOVIE')}
          {sound('sm-music', 'MUSIC', 'border-red-500', 'MUSIC')}
          {sound('sm-game', 'GAME', 'border-blue-500', 'GAME')}
          {sound('sm-pure', 'PURE', 'border-yellow-400', 'PURE DIRECT')}
        </div>
      </div>

      <div className='mt-7 text-center'>
        <div className='text-xl font-light lowercase tracking-[0.35em] text-zinc-200'>marantz</div>
        <div className='mt-1 text-[10px] tracking-[0.2em] text-zinc-500'>RC042SR</div>
      </div>
    </div>
  )
}
