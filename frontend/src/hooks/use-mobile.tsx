import { useViewMode } from '@/lib/view-mode'

// «Мобильное» меню (выезжающая панель): телефон и планшет в портрете (≤ 834 px); решает режим отображения
export function useIsMobile() {
  return useViewMode().sheet
}
