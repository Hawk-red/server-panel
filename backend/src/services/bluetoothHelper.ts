import { existsSync } from 'node:fs'
import { ExecError, sudo } from '../exec.js'

// Включение/выключение Bluetooth и автозагрузка — через root-хелпер (deploy/bluetooth): sudo -n и ровно одна команда из белого списка.
export const HELPER = '/usr/local/sbin/server-panel-bluetooth'
export const COMMANDS = ['status', 'on', 'off', 'autostart-on', 'autostart-off'] as const
export type HelperCommand = (typeof COMMANDS)[number]

export type BtState = {
  active: boolean
  enabled: string // enabled | disabled | masked | ...
  masked: boolean
  autostart: boolean
  rfkill: { soft: boolean | null; hard: boolean | null }
  adapter: boolean
}

export class HelperError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message)
  }
}

export const MISSING = 'хелпер не установлен, выполните install.sh (sudo /opt/server-panel/deploy/bluetooth/install.sh)'

type Runner = (args: string[], opts?: { timeoutMs?: number }) => Promise<string>
export const deps: { run: Runner; exists: (p: string) => boolean } = { run: sudo, exists: existsSync }

const bool3 = (v: unknown) => (typeof v === 'boolean' ? v : null)

// Разбор JSON хелпера; всё лишнее отбрасывается, неполный ответ — ошибка
export function parseState(text: string): BtState {
  let o: Record<string, unknown>
  try {
    o = JSON.parse(text)
  } catch {
    throw new HelperError('хелпер вернул не JSON', 502)
  }
  if (typeof o?.active !== 'boolean' || typeof o.enabled !== 'string') throw new HelperError('хелпер вернул неполный ответ', 502)
  const rf = (o.rfkill ?? {}) as Record<string, unknown>
  return {
    active: o.active,
    enabled: o.enabled,
    masked: o.enabled === 'masked' || o.enabled === 'masked-runtime',
    autostart: o.enabled === 'enabled',
    rfkill: { soft: bool3(rf.soft), hard: bool3(rf.hard) },
    adapter: o.adapter === true,
  }
}

// Вызов хелпера. Команда сверяется с белым списком ещё до sudo; ошибки превращаются в HelperError с понятным текстом
export async function call(cmd: HelperCommand): Promise<BtState> {
  if (!COMMANDS.includes(cmd)) throw new HelperError('недопустимая команда', 400)
  if (!deps.exists(HELPER)) throw new HelperError(MISSING, 503)
  try {
    return parseState(await deps.run([HELPER, cmd], { timeoutMs: cmd === 'status' ? 15_000 : 45_000 }))
  } catch (e) {
    if (e instanceof HelperError) throw e
    const stderr = ((e as ExecError).stderr ?? (e as Error).message ?? '').trim()
    const line = stderr.split('\n')[0] || 'действие не выполнено'
    // Ошибки самого sudo (нет правила / нет файла / нужен пароль) — хелпер не установлен или sudoers не тот
    if (/^sudo: /.test(line) || (e as ExecError).code === 'ENOENT') throw new HelperError(MISSING, 503)
    if ((e as ExecError).code === 4) throw new HelperError(line, 409)
    throw new HelperError(line, 500)
  }
}

export const getState = () => call('status')
export const setPower = (on: boolean) => call(on ? 'on' : 'off')
export const setAutostart = (on: boolean) => call(on ? 'autostart-on' : 'autostart-off')

// Не чаще одной операции в minGap мс (и не параллельно): возвращает 0, если можно, иначе сколько секунд подождать
export function createLimiter(minGapMs = 3000, now: () => number = Date.now) {
  let last = -Infinity
  let busy = false
  return {
    take(): number {
      const wait = last + minGapMs - now()
      if (busy) return 1
      if (wait > 0) return Math.ceil(wait / 1000)
      busy = true
      last = now()
      return 0
    },
    release() {
      busy = false
    },
  }
}
