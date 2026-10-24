// ?focus=apply на странице «Обновления»: прокрутить к блоку с кнопкой «Обновить всё» и ненадолго подсветить. Ничего не запускает.
export const FOCUS_APPLY_MS = 2500
export const FOCUS_APPLY_CLASSES = ['ring-2', 'ring-primary', 'animate-pulse']

type FocusTarget = { scrollIntoView: (o: { behavior: 'smooth'; block: 'center' }) => void; classList: { add: (...c: string[]) => void; remove: (...c: string[]) => void } }

// Возвращает true, если подсветка сработала. Без параметра или без блока (обновлений нет) — ничего не делает.
export function focusApply(focus: string | undefined, el: FocusTarget | null, schedule: (fn: () => void, ms: number) => unknown = setTimeout): boolean {
  if (focus !== 'apply' || !el) return false
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add(...FOCUS_APPLY_CLASSES)
  schedule(() => el.classList.remove(...FOCUS_APPLY_CLASSES), FOCUS_APPLY_MS)
  return true
}
