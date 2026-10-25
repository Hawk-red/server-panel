// Страница «Медиа» (/media-control): вкладки и совместимость со старым адресом /receiver.
export const MEDIA_TABS = ['receiver', 'tv', 'receiver-remote', 'tv-remote', 'universal'] as const
export type MediaTab = (typeof MEDIA_TABS)[number]
export const MEDIA_TAB_TITLES: Record<MediaTab, string> = { receiver: 'Ресивер', tv: 'Телевизор', 'receiver-remote': 'Пульт ресивера', 'tv-remote': 'Пульт ТВ', universal: 'Универсальный' }

export const isMediaTab = (v: unknown): v is MediaTab => typeof v === 'string' && (MEDIA_TABS as readonly string[]).includes(v)
/** Значение ?tab= из адреса; неизвестное — «Ресивер» */
export const parseMediaTab = (v: unknown): MediaTab => (isMediaTab(v) ? v : 'receiver')
/** Старый /receiver?tab=…: «remote» (бывшая вкладка «Пульт») → «Пульт ресивера», остальное — «Ресивер» */
export const legacyReceiverTab = (v: unknown): MediaTab => (v === 'remote' ? 'receiver-remote' : parseMediaTab(v))
