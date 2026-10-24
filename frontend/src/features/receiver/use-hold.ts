import { useEffect, useRef } from 'react'
import { createHold } from '@/lib/receiver-remote'

export const buzz = () => {
  try {
    navigator.vibrate?.(10)
  } catch {
    /* не поддерживается */
  }
}

/** Кнопка с удержанием: pointerdown — команда и повтор, pointerup/leave/cancel — стоп */
export function useHoldButton(fire: () => void) {
  const fireRef = useRef(fire)
  const holdRef = useRef<ReturnType<typeof createHold> | null>(null)
  useEffect(() => {
    fireRef.current = fire
  })
  useEffect(() => {
    holdRef.current = createHold(() => fireRef.current())
    return () => holdRef.current?.stop()
  }, [])
  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      buzz()
      holdRef.current?.start()
    },
    onPointerUp: () => holdRef.current?.stop(),
    onPointerLeave: () => holdRef.current?.stop(),
    onPointerCancel: () => holdRef.current?.stop(),
    onContextMenu: (e: React.SyntheticEvent) => e.preventDefault(),
  }
}
