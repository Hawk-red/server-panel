// Страница «Ресивер»: блоки по умолчанию, ключ порядка и старые адреса для редиректа.
// Порядок хранит общий механизм страниц (SortableBlocks): настройка панели layout.receiver на сервере.

export const RECEIVER_LAYOUT_PAGE = 'receiver'

// Шесть блоков управления (сетка одинаковой высоты) и блок ссылок на всю ширину под ними.
// Бывший блок «power» удалён: кнопка питания теперь в «Навигации». Старые сохранённые порядки с ним не ломаются (applyOrder).
// Порядок по умолчанию; id постоянные (по ним хранится порядок), заголовки — для подписи в режиме изменения
export const RECEIVER_BLOCKS = [
  { id: 'volume', title: 'Громкость' },
  { id: 'inputs', title: 'Входы' },
  { id: 'modes', title: 'Режимы звука' },
  { id: 'quick', title: 'Быстрый выбор' },
  { id: 'nav', title: 'Навигация' },
  { id: 'sound', title: 'Звук и настройки' },
  { id: 'links', title: 'Настройки ресивера (ссылки)' },
] as const

export const RECEIVER_GRID_BLOCKS = RECEIVER_BLOCKS.filter((b) => b.id !== 'links')
