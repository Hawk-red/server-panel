// Классификатор сообщений канала тревог (alert_monitor). ЕДИНСТВЕННОЕ место с правилами категорий.
// При любой правке регулярок/порогов — поднять CLASSIFIER_VERSION: ingest пересчитает старые записи по сохранённому тексту.
export const CLASSIFIER_VERSION = 1

export type AlertCategory = 'ballistic' | 'cruise' | 'missile' | 'hypersonic' | 'aviation' | 'drone' | 'other'

export interface AlertClass {
  categories: AlertCategory[]
  /** ballistic | cruise | missile | hypersonic — но без «просто вылет носителя» (см. takeoffOnly ниже) */
  isMissile: boolean
  /** Отбой / новостной пост — не обстрел, в статистику не идёт */
  ignored: boolean
  ignoreReason: 'clear' | 'news' | null
  /** В тексте сообщается о взлёте носителей (Ту-95/160/22, МіГ-31К) */
  takeoff: boolean
}

// Отбой — не обстрел. «до оголошення відбою» — это ещё действующая угроза, но тоже не новое событие (по ТЗ — игнор)
const CLEAR = /відбій|відбою|відбої|отбой|отбоя/
// Длинные посты (поздравления, сводки, новости) — не оперативные сообщения о тревоге
const NEWS_MAX_LEN = 400
// Взято из alert_monitor/main.py (news_markers)
const NEWS_MARKERS = [
  'посмертно', 'герой україни', 'орден', 'звання присвоєно', 'присвоєно звання', 'вічна пам',
  'світла пам', 'указом президента', 'роковини', 'річниця', 'нагородж', 'медал', 'честь і слава', 'подвиг',
]

// \p{L}-границы вместо \b: \b в JS не понимает кириллицу
const B = '(?<![\\p{L}\\d])'
const re = (src: string) => new RegExp(src, 'u')

// «алістика» — частая опечатка канала (потеряна первая буква)
const BALLISTIC = re('балістичн|балістик|баллистич|баллистик|алістик|іскандер|искандер')
const HYPERSONIC = re(`кинджал|кінджал|${B}м[іиi]г-?\\s?31`)
const CRUISE = re(`крилат|крылат|калібр|калибр|${B}[хx]-?101|${B}[хx]-?555|${B}[хx]-?22${'(?![\\d])'}`)
const AVIATION = re(`${B}ту-?(95|160|22)|(зліт|взлет|взлёт|злетіл|вилетіл).{0,80}стратег|стратег.{0,80}(зліт|взлет|взлёт|злетіл|вилетіл)`)
const DRONE = re(`${B}бпла|шахед|шахід|${B}shahed|${B}дрон|баражуюч\\p{L}*\\s+боєприпас|бандерол|${B}герань|безпілотн`)
// Общая «ракета» без уточнения типа. «Ракетна небезпека» — общая тревога, а не пуск; «ракетне паливо» — вообще не про обстрел.
const MISSILE = re(`${B}ракет`)
const MISSILE_NOISE = re('ракетн\\p{L}*\\s+(небезпек|загроз|палив|двигун|війська|військ)')
const TAKEOFF = re('зліт|взлет|взлёт|злетіл|вилетіл|виліт|вылет')

export function classifyAlert(rawText: string): AlertClass {
  const text = rawText.toLowerCase().replace(/ё/g, 'е')

  if (CLEAR.test(text)) return { categories: [], isMissile: false, ignored: true, ignoreReason: 'clear', takeoff: false }
  if (text.length > NEWS_MAX_LEN || NEWS_MARKERS.some((m) => text.includes(m))) {
    return { categories: [], isMissile: false, ignored: true, ignoreReason: 'news', takeoff: false }
  }

  const ballistic = BALLISTIC.test(text)
  const hypersonic = HYPERSONIC.test(text)
  const cruise = CRUISE.test(text)
  const aviation = AVIATION.test(text)
  const drone = DRONE.test(text)
  // «missile» — только когда тип не уточнён
  const missile = !ballistic && !cruise && !hypersonic && MISSILE.test(text.replace(new RegExp(MISSILE_NOISE, 'gu'), ' '))
  const takeoff = TAKEOFF.test(text) && (aviation || hypersonic)

  const categories: AlertCategory[] = []
  if (ballistic) categories.push('ballistic')
  if (cruise) categories.push('cruise')
  if (missile) categories.push('missile')
  if (hypersonic) categories.push('hypersonic')
  if (aviation) categories.push('aviation')
  if (drone) categories.push('drone')
  if (!categories.length) categories.push('other')

  // Вылет носителей (Ту-95/МіГ-31К) без самого пуска — предупреждение, а не ракетный удар.
  // Если в том же сообщении есть баллистика/крылатые/«ракета на Київ» — это пуск, считаем ракетой.
  const launched = ballistic || cruise || missile || (hypersonic && !takeoff)
  return { categories, isMissile: launched, ignored: false, ignoreReason: null, takeoff }
}
