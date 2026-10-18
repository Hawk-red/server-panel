// Решение «показывать ли «Спит»» — чистая функция. Правила:
//  • SSD (rotational = 0) не спит в смысле шпинделя → всегда 'ssd';
//  • диск без поддержки ATA CHECK POWER STATUS (типично USB-мосты) → 'unknown', состояние не определить;
//  • «Спит» только когда smartctl -n standby САМ сообщил standby И ввода-вывода не было не меньше STANDBY_IDLE_MS
//    (кэш SMART живёт 10 минут: после пробуждения старый «standby» нельзя показывать как текущий);
//  • иначе 'active'; если данных мало (нет SMART/нет истории ввода-вывода) — 'unknown'.
export type PowerState = 'ssd' | 'active' | 'standby' | 'unknown'

export const STANDBY_IDLE_MS = 5 * 60_000

export type PowerInput = {
  rotational: boolean | null // /sys/block/<dev>/queue/rotational; null — не удалось прочитать
  smartStatus: 'ok' | 'failing' | 'standby' | 'unavailable' | null // null — SMART ещё не опрошен
  powerCheckUnsupported: boolean
  idleMs: number | null // сколько мс нет ввода-вывода по /proc/diskstats (нижняя оценка); null — нет данных
}

export function derivePowerState(i: PowerInput): PowerState {
  if (i.rotational === false) return 'ssd'
  if (i.powerCheckUnsupported) return 'unknown'
  if (i.rotational === null) return 'unknown'
  if (i.smartStatus === 'standby') {
    if (i.idleMs === null) return 'unknown'
    return i.idleMs >= STANDBY_IDLE_MS ? 'standby' : 'active'
  }
  if (i.smartStatus === null) return i.idleMs !== null && i.idleMs < STANDBY_IDLE_MS ? 'active' : 'unknown'
  return 'active'
}

// Текст, по которому smartctl/smartd сообщают, что диск не умеет отвечать на ATA CHECK POWER STATUS
const UNSUPPORTED_RE = /no ATA CHECK POWER (STATUS|MODE) support|ATA CHECK POWER (STATUS|MODE)[^\n]*not supported/i
// Настоящее сообщение smartctl при -n standby: «Device is in STANDBY mode, exit(2)» / «… SLEEP mode …».
// Голое /STANDBY|SLEEP/ ловило посторонние слова в JSON и давало ложное «Спит» на SSD.
const STANDBY_RE = /Device is in (STANDBY|SLEEP)/i

export const isPowerCheckUnsupported = (text: string) => UNSUPPORTED_RE.test(text)
export const isStandbyOutput = (text: string) => STANDBY_RE.test(text)
