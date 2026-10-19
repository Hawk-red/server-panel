import { createHash } from 'node:crypto'

// Блоки («группы») страницы «Умный дом». По умолчанию: комната (область HA или комната ручного устройства),
// иначе интеграция HA (Sonoff, Tuya), иначе «Прочее». Владелец может переложить устройство в любой блок и завести свои блоки.
export const ACCENTS = ['info', 'ok', 'warn', 'brand', 'indigo', 'volume'] as const
export type Accent = (typeof ACCENTS)[number]
export const GROUP_ICONS = ['home', 'plug', 'cloud', 'folder', 'box'] as const
export type GroupIcon = (typeof GROUP_ICONS)[number]

export type Group = { id: string; name: string; accent: Accent; icon: GroupIcon; custom: boolean }
export type CustomGroup = { id: string; name: string; accent: Accent; icon: GroupIcon }
export type Groupable = { id: number; room: string | null; groupKey: string | null; ha: { integration: string } | null }

const h8 = (s: string) => createHash('sha1').update(s.toLowerCase()).digest('hex').slice(0, 8)

const INTEGRATIONS: Record<string, { name: string; accent: Accent; icon: GroupIcon }> = {
  sonoff: { name: 'Sonoff', accent: 'ok', icon: 'plug' },
  tuya: { name: 'Tuya', accent: 'brand', icon: 'cloud' },
}
const OTHER: Group = { id: 'int-other', name: 'Прочее', accent: 'indigo', icon: 'box', custom: false }

export const roomGroupId = (room: string) => `room-${h8(room.trim())}`

// Блок по умолчанию (без выбора владельца)
export function defaultGroup(d: Pick<Groupable, 'room' | 'ha'>): Group {
  const room = d.room?.trim()
  if (room) return { id: roomGroupId(room), name: room, accent: ACCENTS[parseInt(h8(room).slice(0, 4), 16) % ACCENTS.length], icon: 'home', custom: false }
  const i = d.ha ? INTEGRATIONS[d.ha.integration] : undefined
  if (d.ha && i) return { id: `int-${d.ha.integration.replace(/[^a-z0-9]/g, '').slice(0, 14)}`, ...i, custom: false }
  return OTHER
}

export const newGroupId = () => `c-${createHash('sha1').update(String(Math.random()) + Date.now()).digest('hex').slice(0, 6)}`
export const accentForNewGroup = (count: number): Accent => ACCENTS[count % ACCENTS.length]

// Блоки и принадлежность устройств. Выбор владельца (groupKey) действует, пока такой блок существует
export function resolveGroups(devices: Groupable[], custom: CustomGroup[]): { groups: Group[]; groupOf: Map<number, string> } {
  const auto = new Map<string, Group>()
  for (const d of devices) {
    const g = defaultGroup(d)
    if (!auto.has(g.id)) auto.set(g.id, g)
  }
  const customMap = new Map(custom.map((c) => [c.id, { ...c, custom: true } as Group]))
  const groupOf = new Map<number, string>()
  const used = new Set<string>()
  for (const d of devices) {
    const id = d.groupKey && (customMap.has(d.groupKey) || auto.has(d.groupKey)) ? d.groupKey : defaultGroup(d).id
    groupOf.set(d.id, id)
    used.add(id)
  }
  // Показываются блоки, где есть устройства, и все собственные блоки владельца (даже пустые)
  const rank = (g: Group) => (g.id.startsWith('room-') ? 0 : g.id === 'int-other' ? 2 : g.id.startsWith('int-') ? 1 : 3)
  const autoShown = [...auto.values()].filter((g) => used.has(g.id)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ru'))
  return { groups: [...autoShown, ...customMap.values()], groupOf }
}

// Проверка входа для собственного блока
export function validateGroupName(raw: unknown): { ok: true; name: string } | { ok: false; message: string } {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (name.length < 1 || name.length > 40) return { ok: false, message: 'Название блока: от 1 до 40 символов' }
  return { ok: true, name }
}
