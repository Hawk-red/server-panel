// Журнал громкости: протяжка регулятора — это десятки команд MV, поэтому в журнал пишется не каждый шаг, а одна запись
// на серию («громкость изменена: от X до Y»). Серия закрывается через seriesMs после последнего изменения.
// Текст проходит через maskSecrets (это делает audit), как и остальные записи журнала.
import { audit } from '../audit.js'

export const volumeLog = { seriesMs: 1500 }

/** Шкала ресивера → «−40,0 dB» (как в интерфейсе панели) */
export function volumeDbText(v: number): string {
  const db = v - 80
  const s = Math.abs(db).toFixed(1).replace('.', ',')
  return `${db < 0 ? '−' : db > 0 ? '+' : ''}${s} dB`
}

let series: { ip: string; from: number; to: number; timer: NodeJS.Timeout | null } | null = null

/** Закрыть серию и записать её одной строкой (вызывается по таймеру простоя; в тестах — вручную) */
export function flushVolumeSeries() {
  if (!series) return
  const s = series
  series = null
  if (s.timer) clearTimeout(s.timer)
  if (s.from === s.to) return // серия ничего не изменила — записи нет
  audit({
    ip: s.ip,
    user: 'admin',
    action: 'receiver.volume',
    target: `${volumeDbText(s.from)} → ${volumeDbText(s.to)}`,
    result: 'ok',
    details: { message: `громкость изменена: от ${volumeDbText(s.from)} до ${volumeDbText(s.to)}`, from: s.from, to: s.to },
  })
}

/** Шаг серии: начало запоминается один раз, конец обновляется каждым шагом */
export function noteVolumeSeries(ip: string, from: number, to: number) {
  if (series && series.ip !== ip) flushVolumeSeries() // другое устройство — своя запись
  if (!series) series = { ip, from, to, timer: null }
  else series.to = to
  if (series.timer) clearTimeout(series.timer)
  series.timer = setTimeout(flushVolumeSeries, volumeLog.seriesMs)
  series.timer.unref?.()
}
