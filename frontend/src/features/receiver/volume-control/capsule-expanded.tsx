// Полноэкранный разворот вида «Капсула»: крупный регулятор того же устройства, свечение акцентом,
// горизонтальный свайп листает акцент по кругу (см. capsule-accent.ts), закрытие — тап по фону или
// свайп вниз за нижнюю границу элемента. Чувствительность вертикальной протяжки здесь выше обычной:
// коэффициент считается от реальной высоты элемента (а не от эвристики «примерно экран» для компактных
// видов), поэтому один свайп по всей высоте капсулы проходит весь диапазон 0…потолок.
import { useEffect, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dragToVolume, levelOf, volumeUnits } from '@/lib/volume-drag'
import { buzz } from '../use-hold'
import { useCapsuleAccent } from './capsule-accent'

type CapsuleExpandedProps = {
  value: number
  max: number
  disabled: boolean
  onSend: (value: number, final: boolean) => void
  onClose: () => void
}

const CLOSE_OVERSCROLL_PX = 70 // насколько нужно утянуть ниже нуля сверх достижения дна, чтобы закрыть
const SWIPE_PX = 40 // порог горизонтального свайпа для переключения акцента
const LOCK_PX = 8 // порог, после которого жест считается определённо вертикальным или горизонтальным
const HOLD_AFTER_RELEASE_MS = 1200 // сколько после отпускания показываем своё значение, пока не придёт сверка с сервера

export function CapsuleExpanded({ value, max, disabled, onSend, onClose }: CapsuleExpandedProps) {
  const { accent, cycle } = useCapsuleAccent()
  const [visible, setVisible] = useState(false)
  // Во время протяжки показываем своё значение (как у обычного регулятора); иначе — то, что прислал сервер
  const [drag, setDrag] = useState<number | null>(null)
  const shown = drag ?? value
  const elRef = useRef<HTMLDivElement>(null)
  const d = useRef({ pid: -1, startX: 0, startY: 0, start: value, sens: 1, mode: 'idle' as 'idle' | 'v' | 'h' })
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Разворачивание/закрытие — переход opacity+scale; появляется на следующий кадр, чтобы transition сработал
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => {
      cancelAnimationFrame(raf)
      if (hold.current) clearTimeout(hold.current)
    }
  }, [])

  const close = () => {
    setVisible(false)
    setTimeout(onClose, 200)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const h = elRef.current?.getBoundingClientRect().height || 1
    Object.assign(d.current, { pid: e.pointerId, startX: e.clientX, startY: e.clientY, start: shown, sens: max / h, mode: 'idle' as const })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (d.current.pid !== e.pointerId) return
    const dx = e.clientX - d.current.startX
    const dy = e.clientY - d.current.startY
    if (d.current.mode === 'idle') {
      if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return
      d.current.mode = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
    }
    if (d.current.mode === 'v') {
      const out = dragToVolume({ start: d.current.start, dy, max, sensitivity: d.current.sens })
      setDrag(out.value)
      onSend(out.value, false)
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (d.current.pid !== e.pointerId) return
    d.current.pid = -1
    const dx = e.clientX - d.current.startX
    const dy = e.clientY - d.current.startY
    if (d.current.mode === 'h') {
      if (Math.abs(dx) > SWIPE_PX) {
        buzz()
        cycle(dx > 0 ? 1 : -1)
      }
    } else if (d.current.mode === 'v') {
      const toZeroPx = d.current.start / d.current.sens // сколько px от старта до нулевой отметки
      if (dy - toZeroPx > CLOSE_OVERSCROLL_PX) {
        close()
        d.current.mode = 'idle'
        return
      }
      onSend(shown, true)
      // пока сервер не подтвердит — держим своё значение, потом снова ориентируемся на присланное
      if (hold.current) clearTimeout(hold.current)
      hold.current = setTimeout(() => setDrag(null), HOLD_AFTER_RELEASE_MS)
    }
    d.current.mode = 'idle'
  }

  const frac = levelOf(shown, max)

  return (
    <div
      role='dialog'
      aria-modal='true'
      aria-label='Громкость — развёрнутый вид'
      className={cn('fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-200', visible ? 'opacity-100' : 'opacity-0')}
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        ref={elRef}
        data-capsule-expanded
        className={cn('relative flex h-[min(72vh,620px)] w-24 flex-col items-center overflow-hidden rounded-full transition-[transform,opacity] duration-200', visible ? 'scale-100 opacity-100' : 'scale-75 opacity-0')}
        style={{
          background: '#121820',
          boxShadow: `inset 0 0 0 1px #ffffff14, inset 0 2px 10px #0008, 0 0 50px 8px ${accent}55, 0 0 110px 26px ${accent}26`,
          touchAction: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          data-fill
          className='absolute inset-x-0 bottom-0 transition-[background] duration-300'
          style={{ height: `${frac * 100}%`, background: `linear-gradient(0deg, ${accent}cc, ${accent}99 60%, ${accent}66)`, opacity: disabled ? 0.35 : 1 }}
        />
        <Volume2 aria-hidden className='pointer-events-none absolute bottom-6 left-1/2 size-7 -translate-x-1/2 text-white/85' />
        <span className='pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 text-2xl font-bold tabular-nums text-white drop-shadow'>
          {volumeUnits(disabled ? null : shown)}
        </span>
      </div>
    </div>
  )
}
