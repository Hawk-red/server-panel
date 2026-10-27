// Три вида регулятора громкости: «Фейдер» (прорезь с бегунком и шкалой), «Полоса» (простая заливка снизу вверх),
// «LED» (столбики из сегментов). Только CSS, ни картинок, ни SVG.
// ВАЖНО: положение заливки, бегунка и сегментов меняется БЕЗ transition — иначе каждое движение пальца
// отрисовывается с задержкой на длину анимации и регулятор кажется «тормозящим». Плавность — только у
// декоративной подсветки (Glow) и цветов. Ограничение роста громкости (+3 за команду) — защита ресивера
// на сервере, на картинку оно не влияет: здесь всегда своё, оптимистичное значение.
import { levelOf, volumeTicks, volumeUnits } from '@/lib/volume-drag'
import { cn } from '@/lib/utils'

export type SkinProps = {
  value: number // шкала ресивера MV
  max: number // потолок (верх рисунка)
  active: boolean // палец на регуляторе
  dir: -1 | 0 | 1 // направление последнего движения (подсветка)
  mute: boolean
  disabled: boolean
  reduced: boolean // prefers-reduced-motion: без анимаций
  compact: boolean
}

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

const accentOf = (p: SkinProps) => (p.active ? '#22d3ee' : '#0891b2')

// ---------- «Фейдер»: прорезь, бегунок и шкала в единицах ресивера ----------
// Всё по ширине резиновое и ограничено карточкой: фиксированных ширин нет, корпус с overflow-hidden,
// поэтому ни при каком значении громкости и ни при какой ширине колонки регулятор за карточку не выходит.
export function FaderSkin(props: SkinProps) {
  const p = props
  const frac = levelOf(p.value, p.max)
  const accent = accentOf(p)
  const pct = `${frac * 100}%`
  return (
    <div data-skin='fader' className='absolute inset-0 overflow-hidden rounded-2xl' style={{ background: 'linear-gradient(170deg,#161b21,#0d1116)' }}>
      <Glow p={p} color={`${accent}99`} />
      <div className='absolute inset-0 flex min-w-0 items-stretch justify-center gap-2 overflow-hidden px-3 pb-14 pt-3'>
        {/* прорезь с бегунком: вертикальные отступы равны половине бегунка, он не вылезает ни вверху, ни внизу */}
        <div className='relative h-full w-10 min-w-0 shrink'>
          <div aria-hidden className='absolute inset-y-3 left-1/2 w-2 -translate-x-1/2 rounded-full' style={{ background: '#0b0f14', boxShadow: 'inset 0 0 3px #000' }} />
          <div className='absolute inset-x-0 inset-y-3'>
            <div data-fill className='absolute bottom-0 left-1/2 w-2 -translate-x-1/2 rounded-full' style={{ height: pct, background: accent, opacity: p.disabled ? 0.3 : 1 }} />
            <div
              data-handle
              className={cn('absolute left-1/2 h-6 w-9 -translate-x-1/2 translate-y-1/2 rounded-md border', ease(p, 'transition-[border-color,box-shadow] duration-150'))}
              style={{
                bottom: pct,
                borderColor: p.active ? accent : '#3f4854',
                background: 'linear-gradient(#4b5563,#232a33 60%,#39414d)',
                boxShadow: p.disabled ? 'none' : `0 1px 4px #0009${p.active ? `, 0 0 14px ${accent}99` : ''}`,
              }}
            />
          </div>
        </div>
        {/* шкала обычными числами (как в приложении ресивера), а не в дБ */}
        <div className='relative h-full w-8 min-w-0 shrink text-[10px] leading-none text-white/45'>
          <div className='absolute inset-x-0 inset-y-3'>
            {volumeTicks(p.max).map((t) => (
              <div key={t.value} data-tick={t.value} className='absolute inset-x-0 flex -translate-y-1/2 items-center gap-1 overflow-hidden' style={{ bottom: `${t.frac * 100}%` }}>
                <span aria-hidden className='h-px w-1.5 shrink-0 bg-white/25' />
                <span className='tabular-nums'>{volumeUnits(t.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- «Полоса»: самый простой вид — заливка снизу вверх, как системный ползунок громкости ----------
export function BarSkin(props: SkinProps) {
  const p = props
  const frac = levelOf(p.value, p.max)
  const accent = accentOf(p)
  return (
    <div data-skin='bar' className='absolute inset-0 overflow-hidden rounded-2xl' style={{ background: '#11161d' }}>
      <div data-fill className='absolute inset-x-0 bottom-0' style={{ height: `${frac * 100}%`, background: accent, opacity: p.disabled ? 0.3 : 1 }} />
    </div>
  )
}

// ---------- «LED»: одинаковые столбики из сегментов; у потолка горят все ----------
const BARS = 7
const SEGS = 12
export function LedSkin(props: SkinProps) {
  const p = props
  const frac = levelOf(p.value, p.max)
  const lit = p.disabled ? 0 : Math.round(frac * SEGS)
  const top = lit >= SEGS * 0.9 ? '#ef4444' : lit > SEGS * 0.7 ? '#facc15' : '#22c55e'
  return (
    <div data-skin='led' className='absolute inset-0 overflow-hidden rounded-2xl' style={{ background: 'linear-gradient(180deg,#07100c,#04070a)' }}>
      <Glow p={p} color={`${top}99`} />
      <div className='absolute inset-0 flex min-w-0 items-stretch justify-center gap-1 overflow-hidden px-3 pb-14 pt-4'>
        {Array.from({ length: BARS }, (_, b) => (
          <div key={b} data-bar className='flex h-full min-w-0 max-w-10 flex-1 flex-col-reverse gap-[2px]'>
            {Array.from({ length: SEGS }, (_, i) => {
              // цвет по месту сегмента: верхние 10% шкалы красные, выше 70% — жёлтые
              const ratio = (i + 1) / SEGS
              const color = ratio > 0.9 ? '#ef4444' : ratio > 0.7 ? '#facc15' : '#22c55e'
              const on = i < lit
              return (
                <div
                  key={i}
                  data-seg={on ? 'on' : 'off'}
                  className='min-h-0 flex-1 rounded-[2px]'
                  style={{ background: color, opacity: on ? 1 : 0.12, boxShadow: on && !p.reduced ? `0 0 ${p.active ? 8 : 5}px ${color}` : undefined }}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
