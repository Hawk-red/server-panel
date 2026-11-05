// Три вида регулятора громкости: «Крутилка» (металлический диск с дугой делений), «Пульт» (фейдер
// DJ-микшера с колпачком и лампочкой), «Капсула» (сплошная пилюля-HUD, без побочных элементов). Только CSS и значки lucide.
//
// Два правила, общие для всех видов:
//  • каждый вид задаёт СВОЙ размер (диск, панель, капсула) и центрируется — карточка облегает содержимое,
//    пустых тёмных полей вокруг маленького регулятора больше нет;
//  • положение (угол стрелки, высота заливки, место колпачка) меняется БЕЗ transition: иначе картинка
//    отстаёт от пальца. Переходы разрешены только цвету и тени (подсветка, лампочка, кнопки).
// Управление во всех видах одно и то же — вертикальная протяжка по области регулятора (её держит volume-knob),
// вид только отражает значение. Ограничение роста громкости (+3 за команду) — защита ресивера на сервере.
import { levelOf, volumeTicks, volumeUnits } from '@/lib/volume-drag'
import { cn } from '@/lib/utils'

export type SkinProps = {
  value: number // шкала ресивера MV
  max: number // потолок (верх шкалы)
  active: boolean // палец на регуляторе
  dir: -1 | 0 | 1 // направление последнего движения
  mute: boolean
  disabled: boolean
  reduced: boolean // prefers-reduced-motion: без анимаций и свечения
  compact: boolean // столбец «Универсального» — та же вёрстка, размеры меньше
  fill?: boolean // «Капсула» в карточке «Громкость»: растянуться на всю высоту родителя (у того — явная высота), а не фиксированные h-48/h-64
  onStep?: (delta: number) => void // не используется видами напрямую, поле оставлено для совместимости типа
}

const accentOf = (p: SkinProps) => (p.active ? '#22d3ee' : '#0e9bb8')
/** Цвет деления по месту на шкале: как на бытовых усилителях — зелёный, жёлтый, красный к максимуму */
const zoneColor = (t: number) => (t > 0.85 ? '#ef4444' : t > 0.6 ? '#facc15' : '#22c55e')
/** Плавность, которую можно отключить по prefers-reduced-motion (только цвет и тень) */
const ease = (p: SkinProps, cls: string) => (p.reduced ? '' : cls)

// ---------- «Крутилка»: шлифованный диск, дуга делений, стрелка ----------
const KNOB_FROM = -135 // угол нуля (отсчёт от 12 часов)
const KNOB_TO = 135 // угол потолка
const KNOB_MARKS = 29
/** Луч из центра диска: вертикальный «спица» нужной длины, повёрнутый на угол (origin — центр) */
function Spoke({ deg, len, children }: { deg: number; len: string; children: React.ReactNode }) {
  return (
    <span aria-hidden className='pointer-events-none absolute bottom-1/2 left-1/2 w-0' style={{ height: len, transformOrigin: '50% 100%', transform: `translateX(-50%) rotate(${deg}deg)` }}>
      {children}
    </span>
  )
}
export function KnobSkin(p: SkinProps) {
  const frac = levelOf(p.value, p.max)
  const angle = KNOB_FROM + frac * (KNOB_TO - KNOB_FROM)
  const accent = accentOf(p)
  return (
    <div data-skin='knob' className={cn('relative mx-auto aspect-square w-full', p.compact ? 'max-w-[9.5rem]' : 'max-w-[12.5rem]')}>
      {/* дуга коротких делений: пройденные горят, остальные приглушены */}
      {Array.from({ length: KNOB_MARKS }, (_, i) => {
        const t = i / (KNOB_MARKS - 1)
        const big = i % 7 === 0
        const on = !p.disabled && t <= frac + 1e-9
        return (
          <Spoke key={i} deg={KNOB_FROM + t * (KNOB_TO - KNOB_FROM)} len='40%'>
            <span
              data-mark={on ? 'on' : 'off'}
              className='absolute left-1/2 top-0 -translate-x-1/2 rounded-full'
              style={{ width: big ? 3 : 2, height: big ? 10 : 6, background: zoneColor(t), opacity: on ? 1 : 0.2, boxShadow: on && !p.reduced ? `0 0 5px ${zoneColor(t)}` : undefined }}
            />
          </Spoke>
        )
      })}
      {/* 4–5 подписей обычными числами (не каждое деление) */}
      {volumeTicks(p.max, p.max > 40 ? 20 : 10).map((t) => (
        <Spoke key={t.value} deg={KNOB_FROM + t.frac * (KNOB_TO - KNOB_FROM)} len='48%'>
          <span data-tick={t.value} className='absolute left-1/2 top-0 text-[10px] leading-none tabular-nums text-muted-foreground' style={{ transform: `translate(-50%, -10%) rotate(${-(KNOB_FROM + t.frac * (KNOB_TO - KNOB_FROM))}deg)` }}>
            {volumeUnits(t.value)}
          </span>
        </Spoke>
      ))}
      {/* сам диск */}
      <div
        className='absolute inset-[26%] rounded-full'
        style={{
          background: 'radial-gradient(circle at 34% 26%,#f8fafc,#cbd5e1 32%,#7c8899 68%,#9aa6b5 82%,#4a5461)',
          boxShadow: p.disabled ? 'inset 0 0 0 1px #0006' : `inset 0 1px 2px #fff9, inset 0 -2px 6px #0007, 0 2px 8px #0008${p.active && !p.reduced ? `, 0 0 14px ${accent}66` : ''}`,
        }}
      >
        <div aria-hidden className='absolute inset-[18%] rounded-full' style={{ background: 'radial-gradient(circle at 50% 50%,#ffffff22,#00000022)' }} />
      </div>
      {/* стрелка-индикатор на диске */}
      <Spoke deg={angle} len='21%'>
        <span data-needle className='absolute left-1/2 top-0 h-3 w-[3px] -translate-x-1/2 rounded-full' style={{ background: p.disabled ? '#94a3b8' : accent, boxShadow: p.disabled || p.reduced ? undefined : `0 0 6px ${accent}` }} />
      </Spoke>
    </div>
  )
}

// ---------- «Пульт»: панель микшера, прорезь, колпачок с насечкой, лампочка ----------
export function MixerSkin(p: SkinProps) {
  const frac = levelOf(p.value, p.max)
  const pct = `${frac * 100}%`
  const accent = accentOf(p)
  return (
    <div
      data-skin='mixer'
      className={cn('relative mx-auto flex w-full items-stretch justify-center gap-2 overflow-hidden rounded-xl border border-white/10 px-3 py-3', p.compact ? 'h-40 max-w-[10.5rem]' : 'h-52 max-w-[12.5rem]')}
      style={{ background: 'linear-gradient(180deg,#1b2128,#101419)' }}
    >
      {/* едва заметная вертикальная штриховка — шлифованная панель */}
      <div aria-hidden className='absolute inset-0 opacity-[0.07]' style={{ background: 'repeating-linear-gradient(90deg,#fff 0 1px,transparent 1px 3px)' }} />
      {/* лампочка: горит, пока палец на фейдере */}
      <span
        data-led={p.active ? 'on' : 'off'}
        aria-hidden
        className={cn('absolute right-2 top-2 size-2 rounded-full', ease(p, 'transition-[background-color,box-shadow] duration-150'))}
        style={{ background: p.active ? accent : '#2a333e', boxShadow: p.active && !p.reduced ? `0 0 8px ${accent}` : undefined }}
      />
      {/* прорезь: отступы сверху и снизу — половина высоты колпачка, поэтому он не вылезает за панель */}
      <div className='relative z-10 h-full w-10 min-w-0 shrink'>
        <div aria-hidden className='absolute inset-y-4 left-1/2 w-2 -translate-x-1/2 rounded-full' style={{ background: '#0a0e13', boxShadow: 'inset 0 0 3px #000' }} />
        <div className='absolute inset-x-0 inset-y-4'>
          <div data-fill className='absolute bottom-0 left-1/2 w-2 -translate-x-1/2 rounded-full' style={{ height: pct, background: accent, opacity: p.disabled ? 0.3 : 1 }} />
          <div
            data-handle
            className={cn('absolute left-1/2 h-8 w-10 -translate-x-1/2 translate-y-1/2 rounded-[5px]', ease(p, 'transition-[box-shadow] duration-150'))}
            style={{
              bottom: pct,
              background: 'linear-gradient(180deg,#e8edf3,#aeb8c4 42%,#4c5560 50%,#8e99a6 58%,#d3dae2)',
              boxShadow: p.disabled ? '0 1px 2px #0008' : `0 2px 5px #000a, inset 0 0 0 1px #ffffff55${p.active && !p.reduced ? `, 0 0 14px ${accent}99` : ''}`,
            }}
          >
            {/* выемка-насечка посередине колпачка */}
            <span aria-hidden className='absolute inset-x-1 top-1/2 h-[3px] -translate-y-1/2 rounded-full' style={{ background: 'linear-gradient(180deg,#2c333c,#8d98a5)' }} />
          </div>
        </div>
      </div>
      {/* шкала обычными числами */}
      <div className='relative z-10 h-full w-8 min-w-0 shrink text-[10px] leading-none text-white/45'>
        <div className='absolute inset-x-0 inset-y-4'>
          {volumeTicks(p.max).map((t) => (
            <div key={t.value} data-tick={t.value} className='absolute inset-x-0 flex -translate-y-1/2 items-center gap-1 overflow-hidden' style={{ bottom: `${t.frac * 100}%` }}>
              <span aria-hidden className='h-px w-1.5 shrink-0 bg-white/25' />
              <span className='tabular-nums'>{volumeUnits(t.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------- «Капсула»: iOS-подобный HUD — сплошная пилюля, заливка одним цветом снизу вверх,
// без делений/циферблата/чисел поверх; число — только короткий бейдж в углу, и только во время протяжки ----------
export function CapsuleSkin(p: SkinProps) {
  const frac = levelOf(p.value, p.max)
  const accent = accentOf(p)
  return (
    <div data-skin='capsule' className={cn('relative mx-auto w-full', p.fill ? 'h-full' : p.compact ? 'h-48' : 'h-64')}>
      <div className='relative h-full w-full overflow-hidden rounded-full' style={{ background: '#121820', boxShadow: 'inset 0 0 0 1px #ffffff14, inset 0 2px 6px #0008' }}>
        <div data-fill className='absolute inset-x-0 bottom-0' style={{ height: `${frac * 100}%`, background: accent, opacity: p.disabled ? 0.35 : 1 }} />
      </div>
      {/* бейдж-число — как временный HUD iOS: в углу капсулы, только пока палец на регуляторе */}
      {p.active && !p.disabled && (
        <span
          aria-hidden
          className='pointer-events-none absolute -top-1.5 -right-1.5 rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-background shadow'
        >
          {volumeUnits(p.value)}
        </span>
      )}
    </div>
  )
}
