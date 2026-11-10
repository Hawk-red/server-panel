import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FastForward,
  Globe,
  Home,
  Menu,
  Mic,
  MousePointer2,
  Music,
  Play,
  Power,
  Rewind,
  Search,
  SquareX,
  VolumeX,
} from 'lucide-react'
import { commandTitle, isCustom, type RemoteConfig } from '@/lib/receiver-pad'
import { isUgoosRepeatable, ugoosKeyStatus, type UgoosStatus } from '@/lib/ugoos-pad'
import { BasePadKey } from '@/features/receiver/pad-key'

// Экранная копия пульта Ugoos Remote UR02 Air Mouse: раскладка по фото оригинала (питание сверху, D-pad в
// светлом кольце заметно крупнее остальных кнопок, вертикальные качельки громкости/доп. кнопки, сетка 2×3
// приложений снизу) — ключ каждой кнопки приходит с сервера (привязки ugoos.remote), подогнать точнее можно
// через «Настроить пульт» без изменения кода.
type KeyProps = {
  id: string
  label: string
  cfg: RemoteConfig | undefined
  st: UgoosStatus | undefined
  configure: boolean
  onPress: (id: string, cmd: string) => void
  onPick: (id: string) => void
  className?: string
  children: React.ReactNode
}

function UgoosKey({ cfg, st, ...p }: KeyProps) {
  const cmd = cfg ? (cfg.bindings[p.id] ?? null) : null
  return <BasePadKey {...p} cmd={cmd} status={ugoosKeyStatus(cmd, st)} custom={cfg ? isCustom(cfg, p.id) : false} cmdTitle={cfg ? commandTitle(cfg, cmd) : '…'} repeatable={isUgoosRepeatable(cmd)} />
}

type PadProps = { st: UgoosStatus | undefined; cfg?: RemoteConfig | undefined; configure: boolean; onPress: (id: string, cmd: string) => void; onPick: (id: string) => void }

// 6 пустых слотов быстрого запуска приложений — значки и цветные точки как на макете; привязка к конкретному
// приложению (source_list) — отдельная задача на будущее
const APP_SLOTS: [string, typeof Globe, string][] = [
  ['app-1', Globe, 'bg-red-500'],
  ['app-2', Search, 'bg-purple-500'],
  ['app-3', Rewind, 'bg-orange-500'],
  ['app-4', FastForward, 'bg-blue-500'],
  ['app-5', Play, 'bg-yellow-400'],
  ['app-6', Music, 'bg-emerald-500'],
]

export function UgoosPad({ st, cfg, configure, onPress, onPick }: PadProps) {
  const c = { cfg, st, configure, onPress, onPick }
  return (
    <div data-remote='UGOOS-SK1' className='mx-auto w-full max-w-[300px] select-none rounded-[2rem] border border-zinc-700 bg-gradient-to-b from-zinc-900 to-black p-5 pb-6 text-zinc-100 shadow-[0_20px_40px_-12px_rgba(0,0,0,.8),inset_0_1px_0_rgba(255,255,255,.08)]'>
      {/* 1. питание: главная (красная) и вторая (серая, без привязки по умолчанию), между ними LED-индикатор */}
      <div className='flex items-center justify-center gap-4'>
        <UgoosKey id='power' label='Питание' {...c} className='size-12 rounded-full from-red-500 to-red-800 text-white'>
          <Power className='size-6' aria-hidden />
        </UgoosKey>
        <span aria-hidden className='size-1.5 rounded-full bg-zinc-500 shadow-[0_0_3px_rgba(255,255,255,.4)]' />
        <UgoosKey id='power2' label='Питание (вторая кнопка)' {...c} className='size-12 rounded-full from-zinc-500 to-zinc-700'>
          <Power className='size-5' aria-hidden />
        </UgoosKey>
      </div>

      {/* 2. mute, курсор/аэромышь, backspace — без привязки у двух последних по умолчанию */}
      <div className='mt-4 grid grid-cols-3 gap-2'>
        <UgoosKey id='mute' label='Mute' {...c} className='h-10 rounded-full justify-self-center'>
          <VolumeX className='size-5' aria-hidden />
        </UgoosKey>
        <UgoosKey id='cursor' label='Курсор (аэромышь)' {...c} className='h-10 rounded-full justify-self-center'>
          <MousePointer2 className='size-4' aria-hidden />
        </UgoosKey>
        <UgoosKey id='settings' label='Backspace' {...c} className='h-10 rounded-full justify-self-center'>
          <SquareX className='size-4' aria-hidden />
        </UgoosKey>
      </div>

      {/* 3. D-pad в светлом кольце — крупнее остальных элементов, OK — чёрный круг в центре */}
      <div className='mt-4 flex justify-center'>
        <div className='grid size-56 grid-cols-3 grid-rows-3 place-items-center rounded-full bg-gradient-to-b from-zinc-100 to-zinc-300 p-2 shadow-[inset_0_2px_10px_rgba(0,0,0,.18),0_6px_14px_rgba(0,0,0,.45)]'>
          <span />
          <UgoosKey id='dpad-up' label='Вверх' {...c} className='size-12 rounded-full'>
            <ChevronUp className='size-5' aria-hidden />
          </UgoosKey>
          <span />
          <UgoosKey id='dpad-left' label='Влево' {...c} className='size-12 rounded-full'>
            <ChevronLeft className='size-5' aria-hidden />
          </UgoosKey>
          <UgoosKey id='ok' label='OK' {...c} className='size-14 rounded-full from-black to-zinc-900 text-sm text-white'>
            OK
          </UgoosKey>
          <UgoosKey id='dpad-right' label='Вправо' {...c} className='size-12 rounded-full'>
            <ChevronRight className='size-5' aria-hidden />
          </UgoosKey>
          <span />
          <UgoosKey id='dpad-down' label='Вниз' {...c} className='size-12 rounded-full'>
            <ChevronDown className='size-5' aria-hidden />
          </UgoosKey>
          <span />
        </div>
      </div>

      {/* 4. назад, домой (светлый круг — заметно светлее остальных кнопок), меню */}
      <div className='mt-4 grid grid-cols-3 gap-2'>
        <UgoosKey id='back' label='Назад' {...c} className='h-10 rounded-full'>
          <ChevronLeft className='size-5' aria-hidden />
        </UgoosKey>
        <UgoosKey id='home' label='Домой' {...c} className='h-10 rounded-full from-zinc-100 to-zinc-300 text-zinc-900'>
          <Home className='size-5' aria-hidden />
        </UgoosKey>
        <UgoosKey id='menu' label='Меню' {...c} className='h-10 rounded-full'>
          <Menu className='size-5' aria-hidden />
        </UgoosKey>
      </div>

      {/* 5. громкость/голос — не строка, а вертикальные качельки слева и справа от микрофона */}
      <div className='mt-4 flex items-stretch justify-center gap-6'>
        <div className='flex w-11 flex-col overflow-hidden rounded-full shadow-[0_2px_0_0_#000,0_4px_5px_rgba(0,0,0,.55)]'>
          <UgoosKey id='vol-up' label='Громкость +' {...c} className='h-9 w-full rounded-none'>
            <span className='text-base leading-none'>+</span>
          </UgoosKey>
          <div className='h-px bg-black/40' />
          <UgoosKey id='vol-down' label='Громкость −' {...c} className='h-9 w-full rounded-none'>
            <span className='text-base leading-none'>−</span>
          </UgoosKey>
        </div>
        <UgoosKey id='mic' label='Микрофон' {...c} className='size-11 self-center rounded-full'>
          <Mic className='size-5' aria-hidden />
        </UgoosKey>
        <div className='flex w-11 flex-col overflow-hidden rounded-full shadow-[0_2px_0_0_#000,0_4px_5px_rgba(0,0,0,.55)]'>
          <UgoosKey id='arrow-up2' label='Канал/страница вверх (доп.)' {...c} className='h-9 w-full rounded-none from-zinc-500 to-zinc-600'>
            <ChevronUp className='size-4' aria-hidden />
          </UgoosKey>
          <div className='h-px bg-black/40' />
          <UgoosKey id='arrow-down2' label='Канал/страница вниз (доп.)' {...c} className='h-9 w-full rounded-none from-zinc-500 to-zinc-600'>
            <ChevronDown className='size-4' aria-hidden />
          </UgoosKey>
        </div>
      </div>

      {/* 6. быстрый запуск приложений — сетка 2×3, иконка + цветная точка-индикатор, пустые слоты */}
      <div className='mt-4 grid grid-cols-2 gap-2'>
        {APP_SLOTS.map(([id, Icon, dot]) => (
          <UgoosKey key={id} id={id} label={`Приложение ${id.slice(-1)}`} {...c} className='h-10 rounded-full'>
            <span className='flex items-center gap-1.5'>
              <Icon className='size-4' aria-hidden />
              <span aria-hidden className={`size-1.5 rounded-full ${dot}`} />
            </span>
          </UgoosKey>
        ))}
      </div>

      {/* 7. логотип */}
      <div className='mt-6 text-center text-[10px] tracking-[0.2em] text-zinc-500'>UGOOS</div>
    </div>
  )
}
