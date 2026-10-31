// Страница «Медиа» (/media-control): три вкладки и совместимость со старыми адресами.
// Прежние вкладки («Ресивер» блоками, «Телевизор», «Пульт ресивера», «Пульт ТВ») из навигации убраны:
// их адреса переносятся сюда — ТВ на «Samsung», ресиверные на «Marantz», остальное на «Универсальный».
export const MEDIA_TABS = ['universal', 'samsung', 'marantz'] as const
export type MediaTab = (typeof MEDIA_TABS)[number]
export const MEDIA_TAB_TITLES: Record<MediaTab, string> = { universal: 'Пульт универсальный', samsung: 'TV', marantz: 'MARANTZ' }

export const isMediaTab = (v: unknown): v is MediaTab => typeof v === 'string' && (MEDIA_TABS as readonly string[]).includes(v)

// Куда ведут прежние значения ?tab= (Map, чтобы ключи вроде «toString» ничего не находили)
const LEGACY = new Map<string, MediaTab>([
  ['tv', 'samsung'],
  ['tv-remote', 'samsung'],
  ['receiver', 'marantz'],
  ['receiver-remote', 'marantz'],
  ['remote', 'marantz'], // ещё более старый /receiver?tab=remote
  ['control', 'marantz'],
])

/** Значение ?tab= из адреса: своё, прежнее или мусор; по умолчанию — «Универсальный» */
export const parseMediaTab = (v: unknown): MediaTab => (isMediaTab(v) ? v : (typeof v === 'string' ? LEGACY.get(v) : undefined) ?? 'universal')
/** Старый /receiver?tab=…: без вкладки — «Marantz» (это была страница ресивера) */
export const legacyReceiverTab = (v: unknown): MediaTab => (v === undefined || v === null || v === '' ? 'marantz' : parseMediaTab(v))
