// Единые правила цвета по типу величины (этап 8). Меняются только здесь.
export type Level = 'ok' | 'warn' | 'danger'

// Направление для процентов:
//  higher-worse  — загрузка CPU, заполнение диска, RAM: < 70 ok, 70–85 warn, > 85 danger
//  higher-better — свободное место, доступность: > 30 ok, 15–30 warn, < 15 danger
//  neutral       — блокировки AdGuard, прогресс торрента, рейтинг: без порогов
export type Direction = 'higher-worse' | 'higher-better' | 'neutral'

export const THRESHOLDS = {
  percent: { warn: 70, danger: 85 },
  tempCpu: { warn: 70, danger: 85 },
  tempDisk: { warn: 45, danger: 55 }, // для HDD 70 °C — уже авария, поэтому своя шкала
}

export function percentLevel(v: number, direction: Direction = 'higher-worse'): Level | null {
  if (direction === 'neutral') return null
  const { warn, danger } = THRESHOLDS.percent
  if (direction === 'higher-better') return v < 100 - danger ? 'danger' : v <= 100 - warn ? 'warn' : 'ok'
  return v > danger ? 'danger' : v >= warn ? 'warn' : 'ok'
}

export function tempLevel(v: number, kind: 'cpu' | 'disk'): Level {
  const t = kind === 'cpu' ? THRESHOLDS.tempCpu : THRESHOLDS.tempDisk
  return v > t.danger ? 'danger' : v >= t.warn ? 'warn' : 'ok'
}

// Текст для значка/подписи — смысл не передаётся только цветом
export const LEVEL_TEXT: Record<Level, string> = { ok: 'в норме', warn: 'близко к порогу', danger: 'выше порога' }

export const TEXT_CLASS: Record<Level, string> = { ok: 'text-ok-foreground', warn: 'text-warn-foreground', danger: 'text-danger-foreground' }
export const FILL_CLASS: Record<Level, string> = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger' }
