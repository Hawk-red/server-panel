// Marantz NR1604: управление по telnet (порт 23). Ресивер держит всего 2 соединения (третье — Connection refused), поэтому
// каждый запрос — короткий сеанс «открыл, команды, закрыл», сеансы идут строго по одному с паузой ≥300 мс.
// Записывать можно только параметры из белого списка WRITABLE (Dynamic EQ/Volume, Reference Level, Tone Defeat).
import net from 'node:net'
import { config } from '../config.js'

export type ReceiverState = {
  power: 'ON' | 'STANDBY' | null
  dynEq: string | null
  dynVol: string | null
  refLev: string | null
  tone: string | null
  multEq: string | null // только чтение
  at: number
}

export class ReceiverError extends Error {
  constructor(
    message: string,
    public code: 'busy' | 'offline' | 'timeout' | 'standby' | 'bad',
  ) {
    super(message)
  }
}

// ключ → команда и допустимые значения
export const WRITABLE = {
  dynEq: { cmd: 'PSDYNEQ', values: ['ON', 'OFF'] },
  dynVol: { cmd: 'PSDYNVOL', values: ['HEV', 'MED', 'LIT', 'OFF'] },
  refLev: { cmd: 'PSREFLEV', values: ['0', '5', '10', '15'] },
  tone: { cmd: 'PSTONE CTRL', values: ['ON', 'OFF'] },
} as const
export type WritableKey = keyof typeof WRITABLE

const QUERY: Record<keyof Omit<ReceiverState, 'at' | 'power'>, string> = {
  dynEq: 'PSDYNEQ ?',
  dynVol: 'PSDYNVOL ?',
  refLev: 'PSREFLEV ?',
  tone: 'PSTONE CTRL ?',
  multEq: 'PSMULTEQ: ?',
}
// префикс ответа на запрос
const PREFIX: Record<keyof typeof QUERY, string> = {
  dynEq: 'PSDYNEQ ',
  dynVol: 'PSDYNVOL ',
  refLev: 'PSREFLEV ',
  tone: 'PSTONE CTRL ',
  multEq: 'PSMULTEQ:',
}

export const timing = { connectMs: 3000, firstReplyMs: 700, quietMs: 150, gapCmdMs: 300, gapSessionMs: 300, cacheMs: 5000 }

type Sock = Pick<net.Socket, 'write' | 'destroy' | 'on' | 'once' | 'removeListener'>
export type Connector = () => Promise<Sock>

const defaultConnector: Connector = () =>
  new Promise((resolve, reject) => {
    const s = net.createConnection({ host: config.marantz.host, port: 23 })
    const timer = setTimeout(() => {
      s.destroy()
      reject(new ReceiverError('Ресивер не ответил на подключение (таймаут 3 с)', 'timeout'))
    }, timing.connectMs)
    s.once('connect', () => {
      clearTimeout(timer)
      resolve(s)
    })
    s.once('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(mapError(e))
    })
  })
let connector: Connector = defaultConnector
export const setConnector = (c: Connector | null) => void (connector = c ?? defaultConnector)

function mapError(e: NodeJS.ErrnoException): ReceiverError {
  if (e instanceof ReceiverError) return e
  if (e.code === 'ECONNREFUSED') return new ReceiverError('Ресивер занят: уже открыты 2 telnet-подключения (приложение или другая программа). Попробуйте позже', 'busy')
  if (e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH' || e.code === 'ETIMEDOUT') return new ReceiverError('Ресивер недоступен в сети', 'offline')
  return new ReceiverError(`Ошибка связи с ресивером: ${e.code ?? e.message}`, 'offline')
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Строки ответа без служебных «@ADE:2», «@VOL:-400» и пустых
export const parseLines = (raw: string) =>
  raw
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('@'))

class Session {
  private buf = ''
  private err: Error | null = null
  private wake: (() => void) | null = null
  constructor(private s: Sock) {
    s.on('data', (d: Buffer) => {
      this.buf += d.toString('latin1')
      this.wake?.()
    })
    s.on('error', (e: Error) => {
      this.err = e
      this.wake?.()
    })
    s.on('close', () => this.wake?.())
  }
  /** Отправляет команду и собирает ответ: до первой строки не дольше firstReplyMs, дальше пока идут данные */
  async send(cmd: string): Promise<string[]> {
    this.buf = ''
    this.s.write(`${cmd}\r`)
    let wait = timing.firstReplyMs
    for (;;) {
      const before = this.buf.length
      await new Promise<void>((res) => {
        const t = setTimeout(res, wait)
        this.wake = () => {
          clearTimeout(t)
          res()
        }
      })
      this.wake = null
      if (this.err) throw mapError(this.err as NodeJS.ErrnoException)
      if (this.buf.length === before) break // тишина
      wait = timing.quietMs
    }
    await sleep(timing.gapCmdMs)
    return parseLines(this.buf)
  }
}

// ---- очередь: сеансы строго по одному, пауза между ними ----
let tail: Promise<unknown> = Promise.resolve()
let lastEnd = 0
async function withSession<T>(fn: (s: Session) => Promise<T>): Promise<T> {
  const run = async () => {
    const gap = lastEnd + timing.gapSessionMs - Date.now()
    if (gap > 0) await sleep(gap)
    let sock: Sock | null = null
    try {
      sock = await connector()
      return await fn(new Session(sock))
    } catch (e) {
      throw mapError(e as NodeJS.ErrnoException)
    } finally {
      sock?.destroy()
      lastEnd = Date.now()
    }
  }
  const p = tail.then(run, run)
  tail = p.catch(() => undefined)
  return p
}

const pick = (lines: string[], prefix: string) => {
  const l = lines.find((x) => x.startsWith(prefix))
  return l ? l.slice(prefix.length).trim() : null
}
export const parsePower = (lines: string[]): 'ON' | 'STANDBY' | null => {
  const v = pick(lines, 'PW')
  return v === 'ON' ? 'ON' : v === 'STANDBY' ? 'STANDBY' : null
}

async function readState(s: Session): Promise<ReceiverState> {
  const power = parsePower(await s.send('PW?'))
  const st: ReceiverState = { power, dynEq: null, dynVol: null, refLev: null, tone: null, multEq: null, at: Date.now() }
  if (power !== 'ON') return st // в режиме ожидания PS-запросы не отвечают
  for (const k of Object.keys(QUERY) as (keyof typeof QUERY)[]) st[k] = pick(await s.send(QUERY[k]), PREFIX[k])
  return st
}

let cache: ReceiverState | null = null

/** Текущее состояние; кэш 5 с, чтобы опрос из нескольких вкладок не занимал telnet-слоты */
export async function getState(force = false): Promise<ReceiverState> {
  if (!force && cache && Date.now() - cache.at < timing.cacheMs) return cache
  const st = await withSession(readState)
  cache = st
  return st
}

export type SetResult = { key: WritableKey; command: string; raw: string[]; before: string | null; after: string | null; state: ReceiverState }

export function validate(key: string, value: string): { key: WritableKey; command: string } {
  if (!Object.hasOwn(WRITABLE, key)) throw new ReceiverError('Этот параметр менять нельзя', 'bad')
  const w = WRITABLE[key as WritableKey]
  if (!(w.values as readonly string[]).includes(value)) throw new ReceiverError('Недопустимое значение', 'bad')
  return { key: key as WritableKey, command: `${w.cmd} ${value}` }
}

/** Запись из белого списка одним сеансом: PW? → значение «до» → команда → значение «после» (реальное, с ресивера) */
export async function setValue(key: string, value: string): Promise<SetResult> {
  const { key: k, command } = validate(key, value)
  cache = null
  const res = await withSession(async (s) => {
    const power = parsePower(await s.send('PW?'))
    if (power !== 'ON') throw new ReceiverError('Ресивер выключен — настройки недоступны', 'standby')
    const q = QUERY[k]
    const before = pick(await s.send(q), PREFIX[k])
    const raw = await s.send(command)
    const after = pick(await s.send(q), PREFIX[k])
    return { raw, before, after }
  })
  cache = null
  const state = await getState(true)
  return { key: k, command, ...res, state }
}
