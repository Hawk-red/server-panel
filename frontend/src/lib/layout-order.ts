// Порядок блоков страницы (чистая логика без React): применение сохранённого порядка и перестановка.

// Сохранённые id — по порядку, новые (которых там нет) — в конец, исчезнувшие — игнорируются
export function applyOrder<T extends { id: string }>(blocks: T[], saved: string[]): T[] {
  const byId = new Map(blocks.map((b) => [b.id, b]))
  const known = saved.filter((id) => byId.has(id)).map((id) => byId.get(id)!)
  const rest = blocks.filter((b) => !saved.includes(b.id))
  return [...known, ...rest]
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const out = list.slice()
  out.splice(to, 0, out.splice(from, 1)[0])
  return out
}
