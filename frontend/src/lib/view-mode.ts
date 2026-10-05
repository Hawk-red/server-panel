import { useSyncExternalStore } from 'react'

// Режим отображения: «Авто» (по ширине экрана), «Телефон», «Планшет». Хранится в localStorage этого устройства.
// ТВ — отдельная версия (/tv), в хранимый режим не входит.
export type ViewMode = 'auto' | 'phone' | 'tablet'
export type View = 'phone' | 'tablet' | 'desktop'

const KEY = 'panel.viewMode'
const PHONE_MAX = 640 // < 640 px — телефон
const TABLET_MAX = 1100 // 640–1100 px — планшет, шире — десктоп
const SHEET_MAX = 834 // меню выезжающее до этой ширины (планшет в портрете)

function readMode(): ViewMode {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'phone' || v === 'tablet' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

let mode: ViewMode = readMode()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function resolveView(m: ViewMode, width: number): { view: View; sheet: boolean } {
  const view: View = m === 'phone' ? 'phone' : m === 'tablet' ? 'tablet' : width < PHONE_MAX ? 'phone' : width < TABLET_MAX ? 'tablet' : 'desktop'
  return { view, sheet: view === 'phone' || (view === 'tablet' && width <= SHEET_MAX) }
}

// Снимок — строка «вид|меню-шторкой|режим», чтобы подписчики перерисовывались только при смене вида, а не на каждый пиксель ресайза
function snapshot() {
  const { view, sheet } = resolveView(mode, window.innerWidth)
  return `${view}|${sheet ? 1 : 0}|${mode}`
}

function apply() {
  document.documentElement.dataset.view = resolveView(mode, window.innerWidth).view
}

export function setViewMode(m: ViewMode) {
  mode = m
  try {
    localStorage.setItem(KEY, m)
  } catch {
    /* приватный режим — просто не запоминаем */
  }
  apply()
  emit()
}

// Вызывается один раз при старте: ставит data-view на <html> (по нему работает CSS телефонного вида)
export function initViewMode() {
  apply()
  window.addEventListener('resize', () => {
    apply()
    emit()
  })
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useViewMode() {
  const [view, sheet, m] = useSyncExternalStore(subscribe, snapshot, () => 'desktop|0|auto').split('|')
  return { view: view as View, sheet: sheet === '1', mode: m as ViewMode, setMode: setViewMode }
}
