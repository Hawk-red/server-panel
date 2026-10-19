// Данные для палитры ⌘K: плоский список элементов из ответов страниц (общий кеш запросов) и фильтр для cmdk.
// Вынесено из компонента, чтобы покрыть тестом ровно то, что вызывает cmdk: filter(value, search, keywords).
import { createMatcher, TIER, type Matcher } from './search.ts'
import type { DiskInfo, DockerData, MediaData, NetworkData, ServiceRow, TorrentsData } from './types.ts'

export type PaletteGroup = 'torrents' | 'docker' | 'services' | 'disks' | 'devices' | 'media'

export const GROUP_HEADING: Record<PaletteGroup, string> = {
  torrents: 'Торренты (активные)',
  docker: 'Docker',
  services: 'Службы',
  disks: 'Диски',
  devices: 'Устройства сети',
  media: 'Медиа',
}

export type PaletteItem = {
  id: string // уникален в пределах палитры (value в cmdk)
  group: PaletteGroup
  title: string
  subtitle?: string
  keywords: string[] // title первым; по ним ищет фильтр
  to: '/torrents' | '/docker' | '/system' | '/disks' | '/network' | '/media' | '/receiver' // выбор только переходит на страницу
  search?: { tab: 'services' }
}

export type PaletteData = {
  torrents?: TorrentsData
  docker?: DockerData
  services?: ServiceRow[]
  disks?: DiskInfo[]
  network?: NetworkData
  media?: MediaData
}

const MARANTZ_IP = '192.168.31.94' // так же подписан ресивер на странице «Ресивер»

export function buildPaletteItems(d: PaletteData): PaletteItem[] {
  const out: PaletteItem[] = []
  for (const t of d.torrents?.summary.data?.active ?? [])
    out.push({ id: `torrent:${t.hash}`, group: 'torrents', title: t.name, keywords: [t.name, t.state], to: '/torrents' })
  for (const c of d.docker?.containers.data ?? [])
    out.push({ id: `container:${c.id}`, group: 'docker', title: c.name, subtitle: c.image, keywords: [c.name, c.image, c.state, c.composeProject ?? ''], to: '/docker' })
  for (const i of d.docker?.images.data ?? [])
    out.push({ id: `image:${i.id}`, group: 'docker', title: i.tags[0] ?? i.id.slice(0, 19), subtitle: 'образ', keywords: i.tags, to: '/docker' })
  for (const s of d.services ?? [])
    out.push({ id: `service:${s.unit}`, group: 'services', title: s.unit, subtitle: s.description, keywords: [s.unit, s.description], to: '/system', search: { tab: 'services' } })
  for (const k of d.disks ?? [])
    out.push({
      id: `disk:${k.device}`, group: 'disks', title: k.label || k.model || k.device, subtitle: k.mount ?? k.device,
      keywords: [k.label ?? '', k.model ?? '', k.mount ?? '', k.device, k.uuid ?? '', k.fstype ?? ''], to: '/disks',
    })
  for (const v of d.network?.devices ?? [])
    out.push({
      id: `device:${v.mac}`, group: 'devices', title: v.name || v.hostname || v.vendor || v.mac, subtitle: v.ip,
      keywords: [v.name ?? '', v.hostname ?? '', v.vendor ?? '', v.ip, v.mac, v.location ?? '', v.note ?? ''], to: '/network',
    })
  // «Медиа»: названия карточек страницы + то, что страница уже получила из /media (контейнеры, версия Jellyfin, адрес ресивера)
  const m = d.media
  const jf = m?.jellyfin.info.data
  out.push(
    { id: 'media:jellyfin', group: 'media', title: 'Jellyfin', subtitle: 'медиасервер', keywords: ['Jellyfin', 'медиасервер', m?.jellyfin.container.data?.name ?? '', jf?.name ?? '', jf?.version ?? ''], to: '/media' },
    { id: 'media:minimserver', group: 'media', title: 'MinimServer', subtitle: 'UPnP/DLNA', keywords: ['MinimServer', 'UPnP DLNA медиасервер', m?.minimserver.container.data?.name ?? ''], to: '/media' },
    { id: 'media:bubbleupnp', group: 'media', title: 'BubbleUPnP Server', subtitle: 'UPnP', keywords: ['BubbleUPnP Server', 'UPnP', m?.bubbleupnpserver.container.data?.name ?? ''], to: '/media' },
    { id: 'media:marantz', group: 'media', title: 'Marantz NR1604', subtitle: `AV-ресивер, ${m?.marantz.data?.host ?? MARANTZ_IP}`, keywords: ['Marantz NR1604', 'AV-ресивер ресивер', 'Marantz', 'марантз', 'пульт ресивера', 'громкость', m?.marantz.data?.host ?? MARANTZ_IP], to: '/receiver' }
  )
  return out
}

// Матчер под запрос кешируется: cmdk зовёт фильтр на каждый элемент при каждой букве
let lastQuery = ''
let lastMatcher: Matcher = createMatcher('')
function matcherFor(search: string): Matcher {
  if (search !== lastQuery) {
    lastQuery = search
    lastMatcher = createMatcher(search)
  }
  return lastMatcher
}

// Заголовок элемента: у элементов палитры value — служебный id (`torrent:…`), заголовок первым в keywords; у разделов value — сам заголовок
const ID_VALUE = /^(torrent|container|image|service|disk|device|media):/
const titleOf = (value: string, keywords?: string[]) => (ID_VALUE.test(value) ? (keywords?.[0] ?? '') : value)

// Сигнатура cmdk: filter(value, search, keywords) → оценка > 0 (0 — скрыть). Берём search из аргумента, а не из состояния компонента:
// cmdk фильтрует сразу при вводе, до перерисовки, и замыкание на состояние отставало бы на одну букву.
// Порядок (cmdk сортирует по оценке и элементы, и группы — по лучшему элементу группы):
//   1) точное совпадение или начало слова в НАЗВАНИИ — выше всего (2 + оценка);
//   2) остальное — оценка по всем полям (название, описание, ключевые слова), совпадение в названии даёт +0.1.
// Так «ssh» ставит «SSH и доступ» первым, а фонетика, опечатки и совпадения только по описанию идут ниже.
export function paletteFilter(value: string, search: string, keywords?: string[]): number {
  if (search.trim() === '') return 1
  const m = matcherFor(search)
  const all = m(value, ...(keywords ?? []))
  if (all === 0) return 0
  const t = m(titleOf(value, keywords))
  if (t >= TIER.prefix) return 2 + t
  return all + (t > 0 ? 0.1 : 0)
}

// То же без cmdk, для тестов: элементы, видимые при запросе, по убыванию оценки
export function filterPaletteItems(items: PaletteItem[], query: string): PaletteItem[] {
  return items
    .map((it) => ({ it, s: paletteFilter('', query, it.keywords) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.it)
}
