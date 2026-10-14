// Событие «сервер перезагружен / включился после аварийного отключения».
// При старте панели сравниваем boot id (/proc/sys/kernel/random/boot_id) с сохранённым в panel.db:
// тот же — это просто перезапуск службы, событие не создаём; другой — сервер загружался заново.
// Штатность предыдущей загрузки — по журналу (были ли systemd-shutdown / Reached target Shutdown/Reboot/Power-Off).
// Если журнал недоступен — запасной признак: последняя метка метрик заметно раньше момента включения.
import { readFileSync } from 'node:fs'
import os from 'node:os'
import { db } from '../db.js'
import { emitEvent } from '../events.js'
import { errText } from '../mask.js'
import { run } from '../exec.js'
import { getSetting, setSetting } from '../settings.js'

export const BOOT_KEY = 'boot.id'
// запасной признак (журнала нет): штатная перезагрузка занимает 1–3 минуты, всё, что дольше, — подозрительно
export const GAP_ABNORMAL_MS = 5 * 60_000

const SHUTDOWN_RE = /Reached target (?:(?:shutdown|reboot|poweroff|halt|final|umount)\.target|(?:System )?(?:Shutdown|Reboot|Power-?Off|Halt)|Unmount All Filesystems|Final Step)|Syncing filesystems and block devices|Sending SIGTERM to remaining processes|Journal stopped|^Shutting down\./im

export type BootDeps = {
  bootId: () => string
  now: () => number
  uptimeSec: () => number
  lastMetricTs: () => number | null
  /** true — штатное завершение, false — нет следов завершения, null — журнал недоступен */
  cleanShutdown: () => Promise<boolean | null>
}

export type BootResult = { kind: 'first' | 'restart' | 'clean' | 'crash'; downMin?: number }

export const minutesWord = (n: number) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'минуту'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'минуты'
  return 'минут'
}

export async function detectBoot(d: BootDeps): Promise<BootResult> {
  const id = d.bootId()
  const saved = getSetting<string | null>(BOOT_KEY, null)
  if (saved === id) return { kind: 'restart' }
  setSetting(BOOT_KEY, id) // сохраняем сразу: повторный запуск панели на этой загрузке не создаст дубль
  if (!saved) return { kind: 'first' } // первый запуск с этой возможностью — сравнивать не с чем

  const bootAt = d.now() - d.uptimeSec() * 1000
  const lastTs = d.lastMetricTs()
  const downMs = lastTs != null ? Math.max(0, bootAt - lastTs) : null
  const clean = await d.cleanShutdown()
  const crashed = clean === null ? downMs != null && downMs > GAP_ABNORMAL_MS : !clean
  const downMin = downMs != null ? Math.max(1, Math.round(downMs / 60_000)) : undefined

  if (crashed) {
    emitEvent({
      kind: 'server.boot',
      level: 'warning',
      text: downMin != null ? `Сервер включился после аварийного отключения. Простой был около ${downMin} ${minutesWord(downMin)}` : 'Сервер включился после аварийного отключения',
      details: { crash: true, downMin: downMin ?? null },
    })
    return { kind: 'crash', downMin }
  }
  emitEvent({ kind: 'server.boot', level: 'info', text: 'Сервер перезагружен', details: { crash: false, downMin: downMin ?? null } })
  return { kind: 'clean', downMin }
}

export const realDeps: BootDeps = {
  bootId: () => readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
  now: () => Date.now(),
  uptimeSec: () => os.uptime(),
  lastMetricTs: () => {
    const r = db.prepare('SELECT MAX(ts) AS ts FROM metric_raw').get() as { ts: number | null }
    return r.ts
  },
  cleanShutdown: async () => {
    try {
      // хвост журнала предыдущей загрузки: при штатном выключении там есть сообщения systemd о завершении
      const out = await run('/usr/bin/journalctl', ['-b', '-1', '-n', '300', '--no-pager', '-o', 'cat'], { timeoutMs: 15_000 })
      if (!out.trim()) return null
      return SHUTDOWN_RE.test(out)
    } catch {
      return null
    }
  },
}

// Вызывать ДО запуска коллектора метрик (иначе «последняя метка» уже будет свежей)
export async function checkBootEvent(log?: { warn: (o: object, m: string) => void }) {
  try {
    await detectBoot(realDeps)
  } catch (e) {
    log?.warn({ err: errText(e) }, 'не удалось определить причину перезагрузки')
  }
}
