// Сцены Home Assistant для плиток «Быстрые сцены»: цвета, значки, порядок и имя по умолчанию (чистые функции, покрыты тестами).
export const SCENE_COLORS = ['green', 'red', 'magenta', 'blue', 'brown', 'emerald', 'violet', 'orange', 'slate', 'cyan'] as const
export const SCENE_ICONS = ['tv', 'power', 'clapperboard', 'flame', 'radio', 'laptop', 'gamepad', 'smartphone', 'lightbulb', 'volume', 'monitor', 'sparkles', 'socket'] as const
export type SceneColor = (typeof SCENE_COLORS)[number]
export type SceneIcon = (typeof SCENE_ICONS)[number]

// Первые восемь — «Запуск одним касанием» из Smart Life; порядок по умолчанию и цвета/значки как на виджете
const KNOWN: Record<string, { color: SceneColor; icon: SceneIcon }> = {
  'scene.tv_on': { color: 'green', icon: 'tv' },
  'scene.o_f_f': { color: 'red', icon: 'power' },
  'scene.mode': { color: 'magenta', icon: 'clapperboard' },
  'scene.fire': { color: 'blue', icon: 'flame' },
  'scene.r_a_d_i_o': { color: 'brown', icon: 'radio' },
  'scene.macbook': { color: 'emerald', icon: 'laptop' },
  'scene.ps4_pro': { color: 'violet', icon: 'gamepad' },
  'scene.android': { color: 'orange', icon: 'smartphone' },
  'scene.m_a_c_m_i_n_i': { color: 'slate', icon: 'monitor' },
  'scene.tv': { color: 'slate', icon: 'tv' },
  'scene.10': { color: 'slate', icon: 'volume' },
  'scene.tv_2': { color: 'slate', icon: 'tv' },
  'scene.led_5': { color: 'slate', icon: 'lightbulb' },
}
export const DEFAULT_SCENE_ORDER = Object.keys(KNOWN)

const OFF_NAME = /^(off|выкл\p{L}*)(\s|$)/iu

// «O F F» → «OFF», «M A C  M I N I  🍏» → «MAC MINI 🍏»: если слово (до двойного пробела) состоит из одиночных букв через пробел — склеиваем.
// Остальные имена не меняются.
export function displayName(haName: string): string {
  const parts = haName.trim().split(/\s{2,}/)
  let changed = false
  const out = parts.map((part) => {
    const tokens = part.split(' ')
    if (tokens.length >= 2 && tokens.every((t) => /^\p{L}$/u.test(t))) {
      changed = true
      return tokens.join('')
    }
    return part
  })
  return changed ? out.join(' ') : haName.trim()
}

export const defaultColor = (entityId: string, haName: string): SceneColor => KNOWN[entityId]?.color ?? (OFF_NAME.test(displayName(haName)) ? 'red' : 'slate')
export const defaultIcon = (entityId: string, haName: string): SceneIcon => KNOWN[entityId]?.icon ?? (OFF_NAME.test(displayName(haName)) ? 'power' : 'sparkles')

// id блока для порядка плиток (layout.smarthome-scenes): ^[a-z0-9-]{1,40}$
export const sceneBlockId = (entityId: string) => `sc-${entityId.split('.')[1] ?? entityId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40)
export const SCENES_LAYOUT_PAGE = 'smarthome-scenes'

// Порядок по умолчанию: известные — как в DEFAULT_SCENE_ORDER, остальные в порядке появления, после них
export function sortScenes<T extends { entityId: string; firstSeen: number }>(list: T[]): T[] {
  const rank = (s: T) => {
    const i = DEFAULT_SCENE_ORDER.indexOf(s.entityId)
    return i >= 0 ? i : DEFAULT_SCENE_ORDER.length
  }
  return [...list].sort((a, b) => rank(a) - rank(b) || a.firstSeen - b.firstSeen || a.entityId.localeCompare(b.entityId))
}

export type ScenePatch = { name?: string | null; color?: SceneColor | null; icon?: SceneIcon | null; hidden?: boolean }
export function validateScenePatch(body: unknown): { ok: true; value: ScenePatch } | { ok: false; message: string; field: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const v: ScenePatch = {}
  if (b.name !== undefined) {
    if (b.name === null) v.name = null
    else if (typeof b.name === 'string' && b.name.trim().length >= 1 && b.name.trim().length <= 60) v.name = b.name.trim()
    else return { ok: false, message: 'Название: от 1 до 60 символов', field: 'name' }
  }
  if (b.color !== undefined) {
    if (b.color === null || (typeof b.color === 'string' && (SCENE_COLORS as readonly string[]).includes(b.color))) v.color = b.color as SceneColor | null
    else return { ok: false, message: 'Неизвестный цвет', field: 'color' }
  }
  if (b.icon !== undefined) {
    if (b.icon === null || (typeof b.icon === 'string' && (SCENE_ICONS as readonly string[]).includes(b.icon))) v.icon = b.icon as SceneIcon | null
    else return { ok: false, message: 'Неизвестный значок', field: 'icon' }
  }
  if (b.hidden !== undefined) {
    if (typeof b.hidden !== 'boolean') return { ok: false, message: 'hidden: true или false', field: 'hidden' }
    v.hidden = b.hidden
  }
  return { ok: true, value: v }
}
