// Регулятор громкости: протяжка пальцем вверх/вниз (Pointer Events + setPointerCapture, страница при этом не скроллится).
// Положение следует за пальцем сразу (оптимистично), на сервер уходит не чаще кадра и только последнее значение
// (этим занимается use-volume). Опрос состояния во время протяжки положение не перезаписывает: показывается своё значение.
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { dragSensitivity, dragSpan, dragToVolume, stepVolume, volumeUnits, VOLUME_SKIN_TITLE, VOLUME_SKINS, type VolumeSkin } from '@/lib/volume-drag'
import { buzz } from '../use-hold'
import { CapsuleSkin, KnobSkin, MixerSkin } from './skins'

export type VolumeKnobProps = {
  value: number | null // текущая громкость по данным сервера (null — неизвестна)
  max: number // потолок (config.marantz.maxVolume с сервера)
  mute: boolean
  disabled: boolean // ресивер выключен или нет связи
  reason?: string | null // подпись, почему регулятор серый
  skin: VolumeSkin
  onSkin?: (s: VolumeSkin) => void // переключатель скина (в компактном виде не показываем)
  onSend: (value: number, final: boolean) => void
  onMute?: () => void
  compact?: boolean
}

/** prefers-reduced-motion: упрощённая подсветка без анимаций */
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => (typeof window === 'undefined' ? false : !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches))
  useEffect(() => {
    const m = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!m) return
    const on = () => setReduced(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return reduced
}

const SKIN_VIEW = { knob: KnobSkin, mixer: MixerSkin, capsule: CapsuleSkin } as const

const HOLD_AFTER_RELEASE_MS = 1800 // сколько показываем своё значение после отпускания (дольше, чем сверка состояния в use-volume)

export function VolumeKnob({ value, max, mute, disabled, reason, skin, onSkin, onSend, onMute, compact = false }: VolumeKnobProps) {
  const reduced = useReducedMotion()
  const [drag, setDrag] = useState<{ value: number; dragging: boolean; dir: -1 | 0 | 1 } | null>(null)
  const d = useRef({ pid: -1, startY: 0, start: 0, sens: 0, last: 0, next: null as number | null, raf: 0, bumped: false })
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (hold.current && clearTimeout(hold.current)), [])

  const shown = drag ? drag.value : (value ?? 0)
  const Skin = SKIN_VIEW[skin]

  const release = (v: number, dragging = false) => {
    if (hold.current) clearTimeout(hold.current)
    setDrag({ value: v, dragging, dir: 0 })
    hold.current = setTimeout(() => setDrag(null), HOLD_AFTER_RELEASE_MS)
  }

  const flush = () => {
    d.current.raf = 0
    const v = d.current.next
    if (v === null) return
    d.current.next = null
    const dir = v > d.current.last ? 1 : v < d.current.last ? -1 : 0
    d.current.last = v
    setDrag({ value: v, dragging: true, dir })
    onSend(v, false)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || value === null) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (hold.current) clearTimeout(hold.current)
    Object.assign(d.current, { pid: e.pointerId, startY: e.clientY, start: value, sens: dragSensitivity(max, dragSpan(window.innerHeight)), last: value, next: null, bumped: false })
    setDrag({ value, dragging: true, dir: 0 })
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (d.current.pid !== e.pointerId) return
    const out = dragToVolume({ start: d.current.start, dy: e.clientY - d.current.startY, max, sensitivity: d.current.sens })
    if (out.atTop && !d.current.bumped) {
      d.current.bumped = true
      buzz() // упор в потолок
    } else if (!out.atTop) d.current.bumped = false
    d.current.next = out.value
    if (!d.current.raf) d.current.raf = requestAnimationFrame(flush)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (d.current.pid !== e.pointerId) return
    d.current.pid = -1
    if (d.current.raf) {
      cancelAnimationFrame(d.current.raf)
      d.current.raf = 0
    }
    const v = d.current.next ?? d.current.last
    d.current.next = null
    onSend(v, true) // финальное значение и сверка состояния
    release(v)
  }

  // кнопки ±5 у «Капсулы»: тот же путь, что у клавиатуры — одно финальное значение, границы 0…потолок
  const step = (delta: number) => {
    if (disabled || value === null) return
    const v = stepVolume(shown, delta, max)
    buzz()
    onSend(v, true)
    release(v)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || value === null) return
    const by = { ArrowUp: 0.5, ArrowDown: -0.5, PageUp: 3, PageDown: -3 } as Record<string, number>
    const v = e.key === 'Home' ? 0 : e.key === 'End' ? max : e.key in by ? stepVolume(shown, by[e.key], max) : null
    if (v === null) return
    e.preventDefault()
    onSend(v, true)
    release(v)
  }

  const active = drag?.dragging === true
  const skinProps = { value: shown, max, active, dir: drag?.dir ?? 0, mute, disabled, reduced, compact, onStep: step }
  return (
    <div data-volume-knob data-skin={skin} data-state={disabled ? 'off' : active ? 'active' : 'on'} className='flex min-w-0 flex-col gap-2'>
      {onSkin && (
        <div className='flex flex-wrap items-center gap-1' role='group' aria-label='Вид регулятора'>
          {VOLUME_SKINS.map((s) => (
            <button
              key={s}
              type='button'
              data-chip={s}
              aria-pressed={s === skin}
              onClick={() => onSkin(s)}
              className={cn('rounded-full border px-3 py-1 text-xs transition-colors', s === skin ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted')}
              style={{ touchAction: 'manipulation' }}
            >
              {VOLUME_SKIN_TITLE[s]}
            </button>
          ))}
        </div>
      )}
      {/* область протяжки: высоту задаёт сам вид регулятора, лишних полей вокруг нет */}
      <div
        role='slider'
        tabIndex={disabled ? -1 : 0}
        aria-label='Громкость ресивера'
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={shown}
        aria-valuetext={volumeUnits(value === null ? null : shown)}
        aria-disabled={disabled}
        data-surface
        className={cn(
          'relative w-full min-w-0 select-none rounded-2xl py-1 outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring',
          disabled ? 'pointer-events-none opacity-45 grayscale' : 'cursor-ns-resize',
          !reduced && 'transition-[filter,opacity] duration-300',
        )}
        style={{ touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Skin {...skinProps} />
      </div>
      {/* значение шкалы обычным числом (как в приложении ресивера, без дБ); тап по нему — Mute */}
      <div className='flex items-end justify-between gap-2'>
        <button
          type='button'
          data-mute
          aria-pressed={mute}
          aria-label={mute ? 'Включить звук' : 'Выключить звук (Mute)'}
          disabled={disabled || !onMute}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            buzz()
            onMute?.()
          }}
          className={cn('-mx-1 rounded-xl px-1 text-left font-bold tabular-nums leading-none', compact ? 'text-2xl' : 'text-3xl', mute ? 'text-destructive' : 'text-foreground', !reduced && 'transition-colors duration-200')}
          style={{ touchAction: 'manipulation' }}
        >
          <span aria-live='polite'>{volumeUnits(value === null ? null : shown)}</span>
          <span className='block text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>{mute ? 'Звук выключен' : 'тап — Mute'}</span>
        </button>
        <span className='text-right text-[10px] leading-tight text-muted-foreground'>
          потолок
          <br />
          {volumeUnits(max)}
        </span>
      </div>
      {disabled && reason && <p className='text-xs text-muted-foreground'>{reason}</p>}
    </div>
  )
}
