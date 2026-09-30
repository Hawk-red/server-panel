import { createContext, useContext } from 'react'

// Режим «Изменить порядок» страницы: включается кнопкой в шапке (Page), читается блоками (SortableBlocks)
export type LayoutEdit = { page: string; editing: boolean; setEditing: (v: boolean) => void }
export const LayoutEditContext = createContext<LayoutEdit | null>(null)
export const useLayoutEdit = () => useContext(LayoutEditContext)
