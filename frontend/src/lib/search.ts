// Общий поиск панели: без учёта регистра (ё = е), слова в любом порядке, разделители = пробелы,
// кириллица ⇄ латиница (фонетический ключ), неверная раскладка (ЙЦУКЕН ⇄ QWERTY), подстроки и опечатки (Левенштейн 1).
// Чистые функции без зависимостей: работают и в браузере, и в тестах.

// ---------- нормализация ----------

// Нижний регистр, ё→е, без диакритики; всё, кроме букв и цифр, — пробел
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const tokenize = (s: string) => (s ? s.split(' ') : [])

// ---------- раскладка ----------

const EN = 'qwertyuiopasdfghjklzxcvbnm'
const RU = 'йцукенгшщзфывапролдячсмить'
// у ЙЦУКЕН 33 буквы; ё, х, ъ, ж, э, б, ю на «знаках» QWERTY ([ ] ; ' , .) — не трогаем: нормализация их всё равно убирает
const EN2RU = new Map<string, string>()
const RU2EN = new Map<string, string>()
for (let i = 0; i < EN.length; i++) {
  EN2RU.set(EN[i], RU[i])
  RU2EN.set(RU[i], EN[i])
}
// раскладка с Е/Ё: «t» = е уже есть; «ё» на QWERTY — «`», игнорируем

export function swapLayout(s: string): string {
  let out = ''
  for (const ch of s.toLowerCase()) out += EN2RU.get(ch) ?? RU2EN.get(ch) ?? ch
  return out
}

// ---------- фонетический ключ ----------

const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya', є: 'e', і: 'i', ї: 'yi', ґ: 'g',
}

// Кириллица → латиница → «фонетический» ключ: слова, звучащие похоже, дают один и тот же ключ.
// Гласные сведены в два класса (a/o/u → a, e/i/y → e), согласные — по звуку (ts/tz → Z, ch → C, sh/sch → S, zh/dzh/j → J, kh → h, c/q → k …),
// повторы схлопнуты. Ключ нужен для поиска «марантз» ⇄ marantz и «хаммингберд» ⇄ hummingbird, точность сознательно ниже обычной.
export function phoneticKey(norm: string): string {
  let t = ''
  for (const ch of norm) t += ch in CYR ? CYR[ch] : ch
  t = t
    .replace(/shch|sch/g, 'S')
    .replace(/dzh|dj|zh|j/g, 'J')
    .replace(/sh/g, 'S')
    .replace(/ch/g, 'C')
    .replace(/kh/g, 'h')
    .replace(/ts|tz|dz/g, 'Z')
    .replace(/ph/g, 'f')
    .replace(/x/g, 'ks')
    .replace(/[cq]/g, 'k')
    .replace(/w/g, 'v')
    .replace(/[aou]/g, 'a')
    .replace(/[eiy]/g, 'e')
  return t.replace(/(.)\1+/g, '$1')
}

// ---------- расстояние Левенштейна (порог 1) ----------

export function within1(a: string, b: string): boolean {
  if (a === b) return true
  const d = a.length - b.length
  if (d > 1 || d < -1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (d === 0) return a.slice(i + 1) === b.slice(i + 1) // замена
  return d === 1 ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1) // удаление / вставка
}

// ---------- подготовка текста ----------

export type Prepared = { tokens: string[]; keys: string[]; joined: string }

const cache = new Map<string, Prepared>()

export function prepare(text: string): Prepared {
  const hit = cache.get(text)
  if (hit) return hit
  const norm = normalize(text)
  const tokens = tokenize(norm)
  const p: Prepared = { tokens, keys: tokens.map((t) => phoneticKey(t)), joined: norm }
  if (cache.size > 5000) cache.clear() // списки живут в памяти страницы, кэш с потолком
  cache.set(text, p)
  return p
}

// ---------- оценка совпадения ----------

const TIER = { exact: 1, prefix: 0.9, substr: 0.75, phExact: 0.65, phPrefix: 0.6, phSubstr: 0.5, fuzzy: 0.3 }

type Variant = { token: string; key: string }

// Лучшая оценка одного слова запроса (с вариантами раскладки) по подготовленному тексту; 0 = не найдено
function tokenScore(variants: Variant[], p: Prepared): number {
  let best = 0
  for (const { token, key } of variants) {
    for (let i = 0; i < p.tokens.length && best < TIER.exact; i++) {
      const w = p.tokens[i]
      let s = 0
      if (w === token) s = TIER.exact
      else if (w.startsWith(token)) s = TIER.prefix
      else if (w.includes(token)) s = TIER.substr
      if (s < TIER.phSubstr && key.length >= 2) {
        const k = p.keys[i]
        if (k === key) s = Math.max(s, TIER.phExact)
        else if (k.startsWith(key)) s = Math.max(s, TIER.phPrefix)
        else if (k.includes(key)) s = Math.max(s, TIER.phSubstr)
      }
      if (s === 0 && key.length >= 5) {
        const k = p.keys[i]
        if (within1(key, k) || [key.length - 1, key.length, key.length + 1].some((n) => n > 0 && n <= k.length && within1(key, k.slice(0, n)))) s = TIER.fuzzy
      }
      if (s > best) best = s
    }
  }
  return best
}

export type Matcher = (...fields: (string | null | undefined)[]) => number

// Матчер под запрос: возвращает оценку 0…1 (0 — не подходит). Все слова запроса должны найтись (в любом порядке, в любых полях).
export function createMatcher(query: string): Matcher {
  const q = normalize(query)
  const direct = tokenize(q)
  if (direct.length === 0) return () => 1
  const swapped = tokenize(normalize(swapLayout(query)))
  const useSwap = swapped.length === direct.length && swapped.join(' ') !== direct.join(' ')
  const words = direct.map((token, i): Variant[] => {
    const v: Variant[] = [{ token, key: phoneticKey(token) }]
    if (useSwap) v.push({ token: swapped[i], key: phoneticKey(swapped[i]) })
    return v
  })
  return (...fields) => {
    const text = fields.filter((f): f is string => !!f).join(' ')
    if (!text) return 0
    const p = prepare(text)
    let sum = 0
    for (const v of words) {
      const s = tokenScore(v, p)
      if (s === 0) return 0
      sum += s
    }
    return sum / words.length
  }
}

// Разовый вызов; для списков создавайте createMatcher один раз
export const searchScore = (query: string, ...fields: (string | null | undefined)[]) => createMatcher(query)(...fields)
export const matches = (query: string, ...fields: (string | null | undefined)[]) => searchScore(query, ...fields) > 0
