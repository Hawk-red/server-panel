import { commandTitle, isCustom, type RemoteConfig } from '@/lib/receiver-pad'
import { isUgoosRepeatable, ugoosKeyStatus, type UgoosStatus } from '@/lib/ugoos-pad'
import { BasePadKey } from '@/features/receiver/pad-key'

// Экранная копия пульта Ugoos Remote UR02 Air Mouse: раскладка 1:1 с утверждённым макетом (пропорции, цвета,
// форма — питание сверху, светлое кольцо D-pad, вертикальные качельки громкости/доп. кнопки, сетка 2×3
// приложений снизу, логотип) — ключ каждой кнопки приходит с сервера (привязки ugoos.remote), подогнать точнее
// можно через «Настроить пульт» без изменения кода.
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

// Иконки — пути перенесены буквально из утверждённого макета (не из lucide-react), чтобы форма совпадала точно
const IconPower = ({ className }: { className?: string }) => (
  <svg viewBox='0 0 24 24' className={className} fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round'>
    <path d='M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10' />
  </svg>
)
const IconMute = ({ className }: { className?: string }) => (
  <svg viewBox='0 0 24 24' className={className} fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round'>
    <polygon points='11 5 6 9 2 9 2 15 6 15 11 19 11 5' />
    <line x1='23' y1='9' x2='17' y2='15' />
    <line x1='17' y1='9' x2='23' y2='15' />
  </svg>
)
const IconCursor = ({ className }: { className?: string }) => (
  <svg viewBox='0 0 24 24' className={className}>
    <path d='M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z' fill='#fff' stroke='none' />
  </svg>
)
const IconBackspace = ({ className }: { className?: string }) => (
  <svg viewBox='0 0 24 24' className={className} fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round'>
    <rect x='3' y='8' width='18' height='8' rx='2' ry='2' />
    <line x1='15' y1='12' x2='17' y2='10' />
    <line x1='15' y1='12' x2='17' y2='14' />
  </svg>
)
const IconBack = ({ className }: { className?: string }) => (
  <svg viewBox='0 0 24 24' className={className} fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round'>
    <polyline points='15 18 9 12 15 6' />
  </svg>
)
const IconHome = ({ className }: { className?: string }) => (
  <svg viewBox='0 0 24 24' className={className} fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round'>
    <path d='M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' />
  </svg>
)
const IconMenu = ({ className }: { className?: string }) => (
  <svg viewBox='0 0 24 24' className={className} fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round'>
    <line x1='4' y1='12' x2='20' y2='12' />
    <line x1='4' y1='6' x2='20' y2='6' />
    <line x1='4' y1='18' x2='20' y2='18' />
  </svg>
)
const IconPlus = ({ className }: { className?: string }) => (
  <svg viewBox='0 0 24 24' className={className} fill='none' stroke='currentColor' strokeWidth={2.5} strokeLinecap='round' strokeLinejoin='round'>
    <line x1='12' y1='5' x2='12' y2='19' />
    <line x1='5' y1='12' x2='19' y2='12' />
  </svg>
)
const IconMinus = ({ className }: { className?: string }) => (
  <svg viewBox='0 0 24 24' className={className} fill='none' stroke='currentColor' strokeWidth={2.5} strokeLinecap='round' strokeLinejoin='round'>
    <line x1='5' y1='12' x2='19' y2='12' />
  </svg>
)
const IconVol = ({ className }: { className?: string }) => (
  <svg viewBox='0 0 24 24' className={className} fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round'>
    <polygon points='11 5 6 9 2 9 2 15 6 15 11 19 11 5' />
    <path d='M15.54 8.46a5 5 0 0 1 0 7.07' />
    <path d='M19.07 4.93a10 10 0 0 1 0 14.14' />
  </svg>
)
const IconChevronUp = ({ className }: { className?: string }) => (
  <svg viewBox='0 0 24 24' className={className} fill='none' stroke='currentColor' strokeWidth={2.5} strokeLinecap='round' strokeLinejoin='round'>
    <polyline points='18 15 12 9 6 15' />
  </svg>
)
const IconChevronDown = ({ className }: { className?: string }) => (
  <svg viewBox='0 0 24 24' className={className} fill='none' stroke='currentColor' strokeWidth={2.5} strokeLinecap='round' strokeLinejoin='round'>
    <polyline points='6 9 12 15 18 9' />
  </svg>
)
const IconMic = ({ className }: { className?: string }) => (
  <svg viewBox='0 0 24 24' className={className} fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round'>
    <path d='M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z' />
    <path d='M19 10v2a7 7 0 0 1-14 0v-2' />
    <line x1='12' y1='19' x2='12' y2='23' />
  </svg>
)
const IconGlobe = ({ className }: { className?: string }) => (
  <svg viewBox='0 0 24 24' className={className} fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round'>
    <circle cx='12' cy='12' r='10' />
    <line x1='2' y1='12' x2='22' y2='12' />
    <path d='M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z' />
  </svg>
)
const IconSearch = ({ className }: { className?: string }) => (
  <svg viewBox='0 0 24 24' className={className} fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round'>
    <circle cx='11' cy='11' r='8' />
    <line x1='21' y1='21' x2='16.65' y2='16.65' />
  </svg>
)
const IconRewind = ({ className }: { className?: string }) => (
  <svg viewBox='0 0 24 24' className={className} fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round'>
    <polygon points='19 20 9 12 19 4 19 20' />
    <line x1='5' y1='19' x2='5' y2='5' />
  </svg>
)
const IconFastForward = ({ className }: { className?: string }) => (
  <svg viewBox='0 0 24 24' className={className} fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round'>
    <polygon points='5 4 15 12 5 20 5 4' />
    <line x1='19' y1='5' x2='19' y2='19' />
  </svg>
)
const IconMusic = ({ className }: { className?: string }) => (
  <svg viewBox='0 0 24 24' className={className} fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round'>
    <path d='M9 18V5l12-2v13' />
    <circle cx='6' cy='18' r='3' />
    <circle cx='18' cy='16' r='3' />
  </svg>
)

// 6 пустых слотов быстрого запуска приложений — значки и цветные точки как на макете (ряд 3 слева повторяет
// иконку fast-forward из ряда 2 — так в утверждённом макете, не ошибка); привязка к конкретному приложению
// (source_list) — отдельная задача на будущее
const APP_SLOTS: [string, typeof IconGlobe, string][] = [
  ['app-1', IconGlobe, 'bg-[#ff3b30]'],
  ['app-2', IconSearch, 'bg-[#af52de]'],
  ['app-3', IconRewind, 'bg-[#ff9500]'],
  ['app-4', IconFastForward, 'bg-[#007aff]'],
  ['app-5', IconFastForward, 'bg-[#ffcc00]'],
  ['app-6', IconMusic, 'bg-[#34c759]'],
]

// Прозрачная кнопка без собственного фона (стрелки D-pad, половинки качельки громкости) — видна только иконка/глиф
const BARE = 'bg-transparent shadow-none active:shadow-none'

export function UgoosPad({ st, cfg, configure, onPress, onPick }: PadProps) {
  const c = { cfg, st, configure, onPress, onPick }
  return (
    <div data-remote='UGOOS-SK1' className="relative mx-auto flex w-[168px] select-none flex-col items-center rounded-[32px] bg-[#363636] px-3 py-4 text-white shadow-[0_15px_35px_rgba(0,0,0,.3),inset_0_1px_2px_rgba(255,255,255,.1),inset_0_-3px_10px_rgba(0,0,0,.4)]">
      {/* 1-2. питание, mute/курсор/backspace — индикатор между двумя кнопками питания */}
      <div className='relative mb-[18px] w-full px-1'>
        <span aria-hidden className="absolute left-1/2 top-3 size-1.5 -translate-x-1/2 rounded-full bg-[#555] shadow-[inset_0_1px_2px_rgba(0,0,0,.5)]" />
        <div className='mb-3 flex w-full items-center justify-between'>
          <UgoosKey id='power' label='Питание' {...c} className='size-[34px] rounded-full bg-[#2a2a2a] text-[#ff3b30]'>
            <IconPower className='size-[18px]' />
          </UgoosKey>
          <UgoosKey id='power2' label='Питание (вторая кнопка)' {...c} className="size-[34px] rounded-full bg-[#b0b0b0] text-[#2a2a2a] shadow-[inset_0_-2px_4px_rgba(0,0,0,.1),0_2px_4px_rgba(0,0,0,.3)]">
            <IconPower className='size-[18px]' />
          </UgoosKey>
        </div>
        <div className='flex w-full items-center justify-between'>
          <UgoosKey id='mute' label='Mute' {...c} className='size-[34px] rounded-full bg-[#2a2a2a]'>
            <IconMute className='size-[18px]' />
          </UgoosKey>
          <UgoosKey id='cursor' label='Курсор (аэромышь)' {...c} className='-my-1.5 size-[36px] rounded-full bg-[#2a2a2a]'>
            <IconCursor className='size-5' />
          </UgoosKey>
          <UgoosKey id='settings' label='Backspace' {...c} className="size-[34px] rounded-full bg-[#b0b0b0] text-[#2a2a2a] shadow-[inset_0_-2px_4px_rgba(0,0,0,.1),0_2px_4px_rgba(0,0,0,.3)]">
            <IconBackspace className='size-[18px]' />
          </UgoosKey>
        </div>
      </div>

      {/* 3. D-pad: светлое кольцо 116px, глифы-стрелки по краям, OK — тёмный круг 54px в центре */}
      <div className='mb-5 mt-[10px] flex justify-center'>
        <div className='relative flex size-[116px] items-center justify-center rounded-full bg-[#f4f4f4]'>
          <UgoosKey id='dpad-up' label='Вверх' {...c} className={`absolute left-1/2 top-[10px] -translate-x-1/2 p-2 text-[10px] font-bold text-[#555] ${BARE}`}>
            ^
          </UgoosKey>
          <UgoosKey id='dpad-down' label='Вниз' {...c} className={`absolute bottom-[10px] left-1/2 -translate-x-1/2 p-2 text-[10px] font-bold text-[#555] ${BARE}`}>
            v
          </UgoosKey>
          <UgoosKey id='dpad-left' label='Влево' {...c} className={`absolute left-[12px] top-1/2 -translate-y-1/2 p-2 text-[10px] font-bold text-[#555] ${BARE}`}>
            &lt;
          </UgoosKey>
          <UgoosKey id='dpad-right' label='Вправо' {...c} className={`absolute right-[12px] top-1/2 -translate-y-1/2 p-2 text-[10px] font-bold text-[#555] ${BARE}`}>
            &gt;
          </UgoosKey>
          <UgoosKey id='ok' label='OK' {...c} className='z-10 size-[54px] rounded-full bg-[#2b2b2b] text-[13px] font-bold text-white'>
            OK
          </UgoosKey>
        </div>
      </div>

      {/* 4. назад, домой (светлый — заметно светлее остальных), меню */}
      <div className='mb-4 flex w-full items-center justify-between px-[10px]'>
        <UgoosKey id='back' label='Назад' {...c} className='size-[30px] rounded-full bg-[#2a2a2a]'>
          <IconBack className='size-[14px]' />
        </UgoosKey>
        <UgoosKey id='home' label='Домой' {...c} className='size-[30px] rounded-full bg-[#f4f4f4] text-[#2b2b2b]'>
          <IconHome className='size-[14px]' />
        </UgoosKey>
        <UgoosKey id='menu' label='Меню' {...c} className='size-[30px] rounded-full bg-[#2a2a2a]'>
          <IconMenu className='size-[14px]' />
        </UgoosKey>
      </div>

      {/* 5. громкость/микрофон/доп. качелька — вертикальные качельки, микрофон смещён вверх над ними */}
      <div className='relative mb-5 flex w-full items-end justify-between px-[10px]'>
        <div className="flex h-[80px] w-[28px] flex-col items-center justify-between rounded-[14px] bg-[#2a2a2a] py-2 shadow-[inset_0_1px_3px_rgba(0,0,0,.4),0_1px_2px_rgba(255,255,255,.05)]">
          <UgoosKey id='vol-up' label='Громкость +' {...c} className={`size-6 rounded-full text-white ${BARE}`}>
            <IconPlus className='size-[14px]' />
          </UgoosKey>
          <IconVol className='size-4 text-white' aria-hidden />
          <UgoosKey id='vol-down' label='Громкость −' {...c} className={`size-6 rounded-full text-white ${BARE}`}>
            <IconMinus className='size-[14px]' />
          </UgoosKey>
        </div>

        <UgoosKey id='mic' label='Микрофон' {...c} className="absolute left-1/2 -top-3 size-[26px] -translate-x-1/2 rounded-full bg-[#2a2a2a]">
          <IconMic className='size-3' />
        </UgoosKey>

        <div className='flex h-[80px] w-[28px] flex-col items-center justify-between rounded-[14px] bg-[#2a2a2a] py-2 shadow-[inset_0_1px_3px_rgba(0,0,0,.4),0_1px_2px_rgba(255,255,255,.05)]'>
          <UgoosKey id='arrow-up2' label='Канал/страница вверх (доп.)' {...c} className={`size-6 rounded-full text-white ${BARE}`}>
            <IconChevronUp className='size-[14px]' />
          </UgoosKey>
          <UgoosKey id='arrow-down2' label='Канал/страница вниз (доп.)' {...c} className={`size-6 rounded-full text-white ${BARE}`}>
            <IconChevronDown className='size-[14px]' />
          </UgoosKey>
        </div>
      </div>

      {/* 6. быстрый запуск приложений — сетка 2×3, плитки-пилюли, точка-индикатор рядом с иконкой, пустые слоты */}
      <div className='mb-[10px] grid w-full grid-cols-2 gap-[10px] px-2'>
        {APP_SLOTS.map(([id, Icon, dot], i) => (
          <UgoosKey key={`${id}-${i}`} id={id} label={`Приложение ${id.slice(-1)}`} {...c} className='h-[26px] w-full justify-self-stretch rounded-[13px] bg-[#2a2a2a]'>
            <span className='flex items-center justify-center gap-2'>
              <Icon className='size-3 text-[#ccc]' />
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot}`} />
            </span>
          </UgoosKey>
        ))}
      </div>

      {/* 7. логотип */}
      <div className='mb-[5px] mt-auto flex flex-col items-center pt-[10px] text-center'>
        <div className="flex items-center text-[18px] font-black tracking-[1.5px] text-white" style={{ fontFamily: '"Arial Black", Impact, sans-serif' }}>
          UGOOS
        </div>
        <div className='mt-[2px] flex flex-col items-center gap-[2px]'>
          <div className='h-[1.5px] w-6 rounded-[2px] bg-white' />
          <div className='h-[1.5px] w-4 rounded-[2px] bg-white' />
          <div className='h-[1.5px] w-2 rounded-[2px] bg-white' />
        </div>
        <div className='ml-[5px] mt-1 text-[7px] uppercase tracking-[5px] text-[#999]'>S M A R T</div>
      </div>
    </div>
  )
}
