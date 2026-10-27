// Три вида регулятора громкости: «Фейдер» (DJ-микшер), «Циферблат» (винтажный Marantz), «LED» (эквалайзер).
// Только SVG и CSS: ни картинок, ни шрифтов. Движется всё на GPU (opacity/transform/filter), фон подсветки — отдельный слой.
import { ceilingOf, levelOf, volumeDb } from '@/lib/volume-drag'
import { cn } from '@/lib/utils'

export type SkinProps = {
  value: number // шкала ресивера MV
  max: number // потолок
  active: boolean // палец на регуляторе
  dir: -1 | 0 | 1 // направление последнего движения (подсветка)
  mute: boolean
  disabled: boolean
  reduced: boolean // prefers-reduced-motion: без анимаций
  compact: boolean
}

type Geom = SkinProps & { frac: number; ceil: number }
const geom = (p: SkinProps): Geom => ({ ...p, frac: levelOf(p.value, p.max), ceil: ceilingOf(p.max) })

/** Плавность, которую можно отключить по prefers-reduced-motion */
const ease = (p: SkinProps, cls: string) => (p.reduced ? '' : cls)

/** Фоновая подсветка за регулятором: вверх — ярче и крупнее, вниз — приглушается */
export function Glow({ p, color }: { p: SkinProps; color: string }) {
  const f = levelOf(p.value, p.max)
  const lift = p.dir === 1 ? 0.18 : p.dir === -1 ? -0.1 : 0
  const opacity = p.disabled ? 0 : Math.max(0.08, Math.min(0.85, 0.12 + f * 0.6 + (p.active ? lift : 0)))
  const scale = 0.75 + f * 0.5 + (p.active && p.dir === 1 ? 0.1 : 0)
  return (
    <div
      aria-hidden
      data-glow
      className={cn('pointer-events-none absolute left-1/2 top-1/2 size-[140%] -translate-x-1/2 -translate-y-1/2 rounded-full will-change-transform', ease(p, 'transition-[opacity,transform] duration-200 ease-out'))}
      style={{ opacity, transform: `translate(-50%, -50%) scale(${p.reduced ? 1 : scale})`, background: `radial-gradient(closest-side, ${color}, transparent 70%)`, filter: p.reduced ? undefined : 'blur(8px)' }}
    />
  )
}

// ---------- «Фейдер» ----------
const SEGMENTS = 18
export function FaderSkin(props: SkinProps) {
  const p = geom(props)
  const lit = Math.round(p.frac * SEGMENTS)
  const accent = p.active ? '#22d3ee' : '#0891b2'
  return (
    <div data-skin='fader' className='absolute inset-0 overflow-hidden rounded-2xl' style={{ background: 'linear-gradient(160deg,#1b2027,#0d1116 55%,#15191f)' }}>
      {/* корпус микшерной панели: щётка металла и неоновая окантовка */}
      <div aria-hidden className='absolute inset-0 opacity-[0.12]' style={{ background: 'repeating-linear-gradient(90deg,#fff 0 1px,transparent 1px 4px)' }} />
      <div aria-hidden className={cn('absolute inset-0 rounded-2xl', ease(props, 'transition-shadow duration-300'))} style={{ boxShadow: `inset 0 0 0 1px ${accent}55, inset 0 0 ${p.active ? 26 : 12}px ${accent}${p.active ? '55' : '22'}` }} />
      <Glow p={props} color={`${accent}aa`} />
      <div className='absolute inset-0 flex items-stretch justify-center px-3 pb-14 pt-4'>
        <div className='flex w-52 max-w-full items-stretch justify-center gap-3 rounded-xl border border-white/5 bg-black/25 px-3 py-3'>
        {/* световая шкала из сегментов: зелёные → жёлтые → красные у потолка */}
        <div className='flex w-3 flex-col-reverse justify-between gap-[2px]'>
          {Array.from({ length: SEGMENTS }, (_, i) => {
            const ratio = i / (SEGMENTS - 1)
            const color = ratio >= p.ceil ? '#ef4444' : ratio > p.ceil * 0.78 ? '#facc15' : '#22c55e'
            const on = i < lit && !p.disabled
            return <div key={i} data-seg={on ? 'on' : 'off'} className={cn('min-h-0 flex-1 rounded-[2px]', ease(props, 'transition-opacity duration-150'))} style={{ background: color, opacity: on ? 1 : 0.14, boxShadow: on && !p.reduced ? `0 0 6px ${color}` : undefined }} />
          })}
        </div>
        {/* сам фейдер: прорезь, подсвеченный пройденный путь, метка потолка и колпачок с насечками */}
        <div className='relative w-16'>
          <div className='absolute bottom-0 left-1/2 top-0 w-2 -translate-x-1/2 rounded-full' style={{ background: 'linear-gradient(#000,#20262e)', boxShadow: 'inset 0 0 3px #000' }} />
          <div className={cn('absolute bottom-0 left-1/2 w-2 -translate-x-1/2 rounded-full', ease(props, 'transition-[height] duration-100'))} style={{ height: `${p.frac * 100}%`, background: `linear-gradient(${accent},#155e75)`, opacity: p.disabled ? 0.3 : 1 }} />
          <div aria-hidden data-ceiling className='absolute left-1/2 h-[2px] w-10 -translate-x-1/2 rounded bg-red-500' style={{ bottom: `${p.ceil * 100}%`, boxShadow: p.reduced ? undefined : '0 0 6px #ef4444' }} />
          <div
            data-handle
            className={cn('absolute left-1/2 h-8 w-14 -translate-x-1/2 rounded-md border', ease(props, 'transition-[bottom,box-shadow,border-color] duration-100'))}
            style={{
              bottom: `calc(${p.frac * 100}% - 1rem)`,
              borderColor: p.active ? accent : '#3f4854',
              background: 'linear-gradient(#4b5563,#1f2630 60%,#39414d)',
              boxShadow: p.disabled ? 'none' : `0 2px 6px #000a${p.active ? `, 0 0 16px ${accent}aa` : ''}`,
            }}
          >
            <div aria-hidden className='absolute inset-x-1 top-1/2 h-[10px] -translate-y-1/2 rounded' style={{ background: 'repeating-linear-gradient(0deg,#0006 0 1px,transparent 1px 3px)' }} />
            <div aria-hidden className='absolute inset-x-2 top-1/2 h-[2px] -translate-y-1/2 rounded' style={{ background: p.active ? accent : '#94a3b8' }} />
          </div>
        </div>
        {/* шкала в дБ с подписями */}
        <div className='flex w-9 flex-col-reverse justify-between text-[10px] leading-none text-white/45'>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const db = Math.round(t * (p.max + 8) - 80)
            return (
              <div key={t} className='flex items-center gap-1'>
                <span className='h-px w-2 bg-white/25' />
                <span className='tabular-nums'>{db > 0 ? `+${db}` : db}</span>
              </div>
            )
          })}
        </div>
        </div>
      </div>
    </div>
  )
}

// ---------- «Циферблат» ----------
const A0 = -130
const A1 = 130
const polar = (deg: number, r: number) => {
  const a = ((deg - 90) * Math.PI) / 180
  return [100 + r * Math.cos(a), 100 + r * Math.sin(a)] as const
}
const arc = (from: number, to: number, r: number) => {
  const [x0, y0] = polar(from, r)
  const [x1, y1] = polar(to, r)
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`
}
export function DialSkin(props: SkinProps) {
  const p = geom(props)
  const angle = A0 + p.frac * (A1 - A0)
  const gold = p.active ? '#fcd34d' : '#d4a24a'
  const ticks = Array.from({ length: 27 }, (_, i) => i / 26)
  const labels = [0, 0.25, 0.5, 0.75, 1]
  return (
    <div data-skin='dial' className='absolute inset-0 overflow-hidden rounded-2xl' style={{ background: 'radial-gradient(120% 120% at 50% 0%,#241d14,#120f0b 60%,#0a0807)' }}>
      <Glow p={props} color={`${gold}99`} />
      <svg viewBox='0 0 200 200' className='absolute inset-0 m-auto h-full w-full p-2' role='img' aria-label={`Громкость ${volumeDb(p.value)}`}>
        <defs>
          <radialGradient id='vk-face' cx='50%' cy='28%' r='80%'>
            <stop offset='0%' stopColor='#2a2219' />
            <stop offset='70%' stopColor='#120e0a' />
            <stop offset='100%' stopColor='#080606' />
          </radialGradient>
          <linearGradient id='vk-glass' x1='0' y1='0' x2='0.4' y2='1'>
            <stop offset='0%' stopColor='#fff' stopOpacity='0.22' />
            <stop offset='45%' stopColor='#fff' stopOpacity='0.04' />
            <stop offset='100%' stopColor='#fff' stopOpacity='0' />
          </linearGradient>
        </defs>
        <circle cx='100' cy='100' r='96' fill='none' stroke={gold} strokeOpacity='0.55' strokeWidth='3' />
        <circle cx='100' cy='100' r='90' fill='url(#vk-face)' stroke='#000' strokeWidth='2' />
        <path d={arc(A0, A1, 74)} fill='none' stroke={gold} strokeOpacity='0.5' strokeWidth='1.5' />
        <path d={arc(A0 + p.ceil * (A1 - A0), A1, 74)} fill='none' stroke='#ef4444' strokeOpacity='0.75' strokeWidth='3' />
        <path d={arc(A0, Math.max(A0 + 0.3, angle), 74)} fill='none' stroke={gold} strokeWidth='4' opacity={p.disabled ? 0.25 : 1} style={props.reduced ? undefined : { transition: 'all 100ms linear' }} />
        {ticks.map((t, i) => {
          const a = A0 + t * (A1 - A0)
          const big = i % 5 === 0
          const [x0, y0] = polar(a, big ? 62 : 67)
          const [x1, y1] = polar(a, 72)
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={t >= p.ceil ? '#ef4444' : gold} strokeOpacity={big ? 0.95 : 0.5} strokeWidth={big ? 2 : 1} />
        })}
        {labels.map((t) => {
          const [x, y] = polar(A0 + t * (A1 - A0), 48)
          const db = Math.round(t * (p.max + 8) - 80)
          return (
            <text key={t} x={x} y={y + 3} textAnchor='middle' fontSize='11' fill={gold} fillOpacity='0.85'>
              {db > 0 ? `+${db}` : db}
            </text>
          )
        })}
        {/* стрелка и ступица */}
        <g transform={`rotate(${angle} 100 100)`} style={props.reduced ? undefined : { transition: 'transform 90ms linear' }} opacity={p.disabled ? 0.35 : 1}>
          <polygon points='100,26 104,104 96,104' fill={p.active ? '#fde68a' : '#f0b64c'} />
          <circle cx='100' cy='100' r='9' fill='#2b2318' stroke={gold} strokeWidth='2' />
        </g>
        {/* стекло с бликом */}
        <ellipse cx='78' cy='62' rx='62' ry='44' fill='url(#vk-glass)' />
      </svg>
    </div>
  )
}

// ---------- «LED» ----------
const BARS = 11
const PATTERN = [0.62, 0.8, 0.95, 0.74, 1, 0.88, 1, 0.7, 0.92, 0.78, 0.6]
export function LedSkin(props: SkinProps) {
  const p = geom(props)
  return (
    <div data-skin='led' className='absolute inset-0 overflow-hidden rounded-2xl' style={{ background: 'linear-gradient(180deg,#07100c,#04070a)' }}>
      <Glow p={props} color={p.frac >= p.ceil * 0.95 ? '#ef444499' : p.frac > p.ceil * 0.7 ? '#facc1599' : '#22c55e99'} />
      <div className='absolute inset-0 px-3 pb-14 pt-5'>
        <div className='relative flex h-full items-end justify-center gap-[3px]'>
          {/* метка потолка: столбики упираются ровно в неё */}
          <div aria-hidden data-ceiling className='absolute inset-x-0 h-[2px] rounded bg-red-500/80' style={{ bottom: `${p.ceil * 100}%`, boxShadow: p.reduced ? undefined : '0 0 8px #ef4444' }} />
          {Array.from({ length: BARS }, (_, i) => {
            const h = Math.max(0.03, Math.min(1, p.frac * PATTERN[i]))
            const color = h >= p.ceil * 0.95 ? '#ef4444' : h > p.ceil * 0.7 ? '#facc15' : '#22c55e'
            const bright = p.active ? 1 : 0.86
            return (
              <div key={i} className='relative h-full max-w-12 flex-1'>
                <div
                  data-bar
                  className={cn('absolute bottom-0 w-full rounded-sm', ease(props, 'transition-[height,background-color] duration-100'))}
                  style={{
                    height: `${h * 100}%`,
                    background: `linear-gradient(180deg,${color},${color}99)`,
                    opacity: p.disabled ? 0.25 : bright,
                    boxShadow: p.disabled || p.reduced ? undefined : `0 0 ${p.active ? 14 : 8}px ${color}`,
                  }}
                />
                <div aria-hidden className='absolute inset-0 rounded-sm' style={{ background: 'repeating-linear-gradient(0deg,#0009 0 2px,transparent 2px 6px)' }} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
