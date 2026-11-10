import {
  ArrowDown,
  ArrowUp,
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
  Settings,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { commandTitle, isCustom, type RemoteConfig } from '@/lib/receiver-pad'
import { isUgoosRepeatable, ugoosKeyStatus, type UgoosStatus } from '@/lib/ugoos-pad'
import { BasePadKey } from '@/features/receiver/pad-key'

// Экранная копия пульта UGOOS SK1: раскладка приблизительная (фото оригинала не передавалось, только словесное
// описание кнопок) — ключ каждой кнопки приходит с сервера (привязки ugoos.remote), подогнать точнее можно
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

// 6 пустых слотов быстрого запуска приложений — значки как на макете (глобус/поиск/перемотка-назад/плей/
// перемотка-вперёд/нота); привязка к конкретному приложению (source_list) — отдельная задача на будущее
const APP_SLOTS: [string, typeof Globe][] = [
  ['app-1', Globe],
  ['app-2', Search],
  ['app-3', Rewind],
  ['app-4', Play],
  ['app-5', FastForward],
  ['app-6', Music],
]

export function UgoosPad({ st, cfg, configure, onPress, onPick }: PadProps) {
  const c = { cfg, st, configure, onPress, onPick }
  return (
    <div data-remote='UGOOS-SK1' className='mx-auto w-full max-w-[300px] select-none rounded-[2rem] border border-zinc-700 bg-gradient-to-b from-zinc-900 to-black p-5 pb-6 text-zinc-100 shadow-[0_20px_40px_-12px_rgba(0,0,0,.8),inset_0_1px_0_rgba(255,255,255,.08)]'>
      {/* питание: главная (красная) и вторая (серая, без привязки по умолчанию) */}
      <div className='flex items-center justify-between'>
        <UgoosKey id='power' label='Питание' {...c} className='size-12 rounded-full from-red-500 to-red-800 text-white'>
          <Power className='size-6' aria-hidden />
        </UgoosKey>
        <UgoosKey id='power2' label='Питание (вторая кнопка)' {...c} className='size-9 rounded-full'>
          <Power className='size-4' aria-hidden />
        </UgoosKey>
      </div>

      {/* микрофон (голосовой ввод — ADB для этого не подходит, без привязки по умолчанию) */}
      <div className='mt-4 flex justify-center'>
        <UgoosKey id='mic' label='Микрофон' {...c} className='size-12 rounded-full'>
          <Mic className='size-5' aria-hidden />
        </UgoosKey>
      </div>

      {/* две стрелки под микрофоном — назначение не ясно, без привязки по умолчанию */}
      <div className='mt-3 flex justify-center gap-6'>
        <UgoosKey id='arrow-up2' label='Стрелка вверх (доп.)' {...c} className='h-9 w-14 rounded-full'>
          <ArrowUp className='size-4' aria-hidden />
        </UgoosKey>
        <UgoosKey id='arrow-down2' label='Стрелка вниз (доп.)' {...c} className='h-9 w-14 rounded-full'>
          <ArrowDown className='size-4' aria-hidden />
        </UgoosKey>
      </div>

      {/* курсор и настройки — без привязки по умолчанию */}
      <div className='mt-3 flex justify-center gap-6'>
        <UgoosKey id='cursor' label='Курсор' {...c} className='h-9 w-14 rounded-xl'>
          <MousePointer2 className='size-4' aria-hidden />
        </UgoosKey>
        <UgoosKey id='settings' label='Настройки' {...c} className='h-9 w-14 rounded-xl'>
          <Settings className='size-4' aria-hidden />
        </UgoosKey>
      </div>

      {/* D-pad: вверх/вниз/влево/вправо/OK */}
      <div className='mt-4 flex justify-center'>
        <div className='grid size-44 grid-cols-3 grid-rows-3 place-items-center rounded-full bg-gradient-to-b from-zinc-800 to-zinc-950 p-2 shadow-[inset_0_2px_8px_rgba(0,0,0,.8),0_1px_0_rgba(255,255,255,.08)]'>
          <span />
          <UgoosKey id='dpad-up' label='Вверх' {...c} className='size-11 rounded-full'>
            <ChevronUp className='size-5' aria-hidden />
          </UgoosKey>
          <span />
          <UgoosKey id='dpad-left' label='Влево' {...c} className='size-11 rounded-full'>
            <ChevronLeft className='size-5' aria-hidden />
          </UgoosKey>
          <UgoosKey id='ok' label='OK' {...c} className='size-12 rounded-full border border-zinc-500 text-sm'>
            OK
          </UgoosKey>
          <UgoosKey id='dpad-right' label='Вправо' {...c} className='size-11 rounded-full'>
            <ChevronRight className='size-5' aria-hidden />
          </UgoosKey>
          <span />
          <UgoosKey id='dpad-down' label='Вниз' {...c} className='size-11 rounded-full'>
            <ChevronDown className='size-5' aria-hidden />
          </UgoosKey>
          <span />
        </div>
      </div>

      {/* назад, домой, меню */}
      <div className='mt-4 grid grid-cols-3 gap-2'>
        <UgoosKey id='back' label='Назад' {...c} className='h-10 rounded-full'>
          <ChevronLeft className='size-5' aria-hidden />
        </UgoosKey>
        <UgoosKey id='home' label='Домой' {...c} className='h-10 rounded-full'>
          <Home className='size-5' aria-hidden />
        </UgoosKey>
        <UgoosKey id='menu' label='Меню' {...c} className='h-10 rounded-full'>
          <Menu className='size-5' aria-hidden />
        </UgoosKey>
      </div>

      {/* громкость и mute */}
      <div className='mt-4 grid grid-cols-3 items-center gap-2'>
        <UgoosKey id='vol-down' label='Громкость −' {...c} className='h-11 rounded-full'>
          <Volume2 className='size-4' aria-hidden />
          <span className='ml-1 text-base leading-none'>−</span>
        </UgoosKey>
        <UgoosKey id='mute' label='Mute' {...c} className='size-11 rounded-full justify-self-center'>
          <VolumeX className='size-5' aria-hidden />
        </UgoosKey>
        <UgoosKey id='vol-up' label='Громкость +' {...c} className='h-11 rounded-full'>
          <Volume2 className='size-5' aria-hidden />
          <span className='ml-1 text-base leading-none'>+</span>
        </UgoosKey>
      </div>

      {/* быстрый запуск приложений — пустые слоты, донастраиваются позже */}
      <div className='mt-4 grid grid-cols-3 gap-2'>
        {APP_SLOTS.slice(0, 3).map(([id, Icon]) => (
          <UgoosKey key={id} id={id} label={`Приложение ${id.slice(-1)}`} {...c} className='size-11 justify-self-center rounded-full'>
            <Icon className='size-4' aria-hidden />
          </UgoosKey>
        ))}
      </div>
      <div className='mt-2 grid grid-cols-3 gap-2'>
        {APP_SLOTS.slice(3, 6).map(([id, Icon]) => (
          <UgoosKey key={id} id={id} label={`Приложение ${id.slice(-1)}`} {...c} className='size-11 justify-self-center rounded-full'>
            <Icon className='size-4' aria-hidden />
          </UgoosKey>
        ))}
      </div>

      <div className='mt-6 text-center text-[10px] tracking-[0.2em] text-zinc-500'>UGOOS SK1</div>
    </div>
  )
}
