// Математика регулятора громкости без React: относительная протяжка → значение шкалы, разметка шкалы с потолком,
// отправка «только последнего значения» (один запрос в полёте). Всё чистое и проверяется тестами.

export const VOLUME_SKINS = ['fader', 'bar', 'led'] as const
export type VolumeSkin = (typeof VOLUME_SKINS)[number]
export const VOLUME_SKIN_TITLE: Record<VolumeSkin, string> = { fader: 'Фейдер', bar: 'Полоса', led: 'LED' }
export const isVolumeSkin = (v: unknown): v is VolumeSkin => typeof v === 'string' && (VOLUME_SKINS as readonly string[]).includes(v)
/** Прежний скин «Циферблат» убран (дёргалась стрелка); сохранённое значение читается как «Полоса» */
export const parseVolumeSkin = (v: unknown): VolumeSkin => (isVolumeSkin(v) ? v : v === 'dial' ? 'bar' : 'fader')

/** Шаг шкалы: ресивер понимает половины */
export const STEP = 0.5

const halfStep = (v: number) => Math.round(v / STEP) * STEP

/** Длина протяжки, на которой проходится весь диапазон: примерно экран в высоту, но не меньше 260 и не больше 620 px */
export const dragSpan = (viewportPx: number) => Math.min(Math.max(Math.round(viewportPx * 0.75), 260), 620)
/** Чувствительность: единиц шкалы на пиксель (медленным движением получается точная подстройка по 0,5) */
export const dragSensitivity = (max: number, spanPx: number) => max / Math.max(1, spanPx)

export type DragOut = { value: number; atTop: boolean; atBottom: boolean }
/** Относительная протяжка: палец вверх (dy < 0) увеличивает. value = стартовое − dy × чувствительность, с обрезкой по потолку */
export function dragToVolume(o: { start: number; dy: number; max: number; sensitivity: number }): DragOut {
  const raw = o.start - o.dy * o.sensitivity
  const top = halfStep(o.max)
  const value = Math.min(Math.max(halfStep(raw), 0), top)
  return { value, atTop: raw >= top, atBottom: raw <= 0 }
}

/** Шаг клавиатурой (↑/↓, PageUp/PageDown) */
export const stepVolume = (value: number, delta: number, max: number) => Math.min(Math.max(halfStep(value + delta), 0), halfStep(max))

/** Доля шкалы 0..1: верх рисунка — потолок, поэтому у потолка заливка доходит до самого верха */
export const levelOf = (value: number, max: number) => Math.min(1, Math.max(0, value / Math.max(STEP, halfStep(max))))

// Шкала ресивера (MV00…MV98, 0 dB = MV80) показывается так же, как в приложении ресивера: обычными числами
// 0…потолок, без дБ. Протокол и API это не меняет — перевода тут нет, только формат показа.
/** Значение шкалы → число для показа: «52», «52,5», «—» */
export function volumeUnits(value: number | null): string {
  if (value === null) return '—'
  return String(halfStep(value)).replace('.', ',')
}

export type VolumeTick = { value: number; frac: number }
/** Подписи шкалы: каждые 10 единиц от нуля и сам потолок */
export function volumeTicks(max: number, step = 10): VolumeTick[] {
  const top = Math.max(STEP, halfStep(max))
  const out: VolumeTick[] = []
  for (let v = 0; v < top; v += step) out.push({ value: v, frac: levelOf(v, max) })
  out.push({ value: top, frac: 1 })
  return out
}

/** Регулятор доступен только когда ресивер включён и сообщил громкость */
export const knobDisabled = (st: { power?: string | null; volume?: number | null } | undefined) => !st || st.power !== 'ON' || st.volume === null

export type LatestSender = {
  /** Отправить значение: в полёте всегда один запрос, ждёт только самое свежее значение */
  push: (value: number, final?: boolean) => void
  readonly busy: boolean
  readonly queued: number | null
}
/** «Только последнее значение»: пока ответ не пришёл, новое значение заменяет отложенное (очередь не копится) */
export function createLatestSender(send: (value: number, final: boolean) => Promise<unknown>): LatestSender {
  let next: { value: number; final: boolean } | null = null
  let busy = false
  const pump = () => {
    if (busy || !next) return
    const cur = next
    next = null
    busy = true
    void send(cur.value, cur.final).then(
      () => {
        busy = false
        pump()
      },
      () => {
        busy = false
        pump()
      },
    )
  }
  return {
    push(value, final = false) {
      next = { value, final: final || (next?.final ?? false) }
      pump()
    },
    get busy() {
      return busy
    },
    get queued() {
      return next?.value ?? null
    },
  }
}
