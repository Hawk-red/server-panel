// Marantz NR1604: пульт по telnet (порт 23). Ресивер держит всего 2 соединения (третье — Connection refused), поэтому у панели
// максимум одно: общий короткоживущий сеанс (закрывается после timing.idleMs простоя). Все команды идут строго по одной,
// между разными соединениями пауза ≥ gapSessionMs. Записывать можно только команды из белого списка (FIXED, SI<вход>, WRITABLE).
import net from 'node:net'
import { config } from '../config.js'
import { http } from '../http.js'

export type InputDef = { code: string; name: string }

export type ReceiverState = {
  power: 'ON' | 'STANDBY' | null
  volume: number | null // шкала ресивера MV (абсолютная), dB = volume − 80
  volumeDb: number | null
  maxVolume: number
  mute: boolean | null
  input: { code: string | null; name: string | null } | null
  inputs: InputDef[]
  mode: string | null
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
    public code: 'busy' | 'offline' | 'timeout' | 'standby' | 'bad' | 'limit' | 'rate',
  ) {
    super(message)
  }
}

// ---------- белые списки ----------
// ключ → команда и допустимые значения (переключатели звука)
export const WRITABLE = {
  dynEq: { cmd: 'PSDYNEQ', values: ['ON', 'OFF'] },
  dynVol: { cmd: 'PSDYNVOL', values: ['HEV', 'MED', 'LIT', 'OFF'] },
  refLev: { cmd: 'PSREFLEV', values: ['0', '5', '10', '15'] },
  tone: { cmd: 'PSTONE CTRL', values: ['ON', 'OFF'] },
} as const
export type WritableKey = keyof typeof WRITABLE

export type CmdClass = 'power' | 'volume' | 'mute' | 'nav' | 'mode' | 'quick' | 'input'
// Ровно эти команды пульта (абсолютная громкость MV<число> не допускается)
export const FIXED: Record<string, CmdClass> = {
  PWON: 'power',
  PWSTANDBY: 'power',
  MVUP: 'volume',
  MVDOWN: 'volume',
  MUON: 'mute',
  MUOFF: 'mute',
  MNCUP: 'nav',
  MNCDN: 'nav',
  MNCLT: 'nav',
  MNCRT: 'nav',
  MNENT: 'nav',
  MNRTN: 'nav',
  'MNMEN ON': 'nav',
  'MNMEN OFF': 'nav',
  MNINF: 'nav',
  MNOPT: 'nav',
  MSQUICK1: 'quick',
  MSQUICK2: 'quick',
  MSQUICK3: 'quick',
  MSMOVIE: 'mode',
  MSMUSIC: 'mode',
  MSGAME: 'mode',
  MSDIRECT: 'mode',
  'MSPURE DIRECT': 'mode',
  MSSTEREO: 'mode',
}
// Коды входов (SI<код>); реально доступны только те, что есть в списке самого ресивера (loadInputs)
export const INPUT_CODES = ['SAT/CBL', 'DVD', 'BD', 'GAME', 'AUX1', 'AUX2', 'MPLAY', 'CD', 'TV', 'TUNER'] as const

export function classify(command: string): CmdClass {
  if (Object.hasOwn(FIXED, command)) return FIXED[command]
  const m = /^SI(.+)$/.exec(command)
  if (m && (INPUT_CODES as readonly string[]).includes(m[1])) return 'input'
  throw new ReceiverError('Эта команда недопустима', 'bad')
}

const QUERY = { dynEq: 'PSDYNEQ ?', dynVol: 'PSDYNVOL ?', refLev: 'PSREFLEV ?', tone: 'PSTONE CTRL ?', multEq: 'PSMULTEQ: ?' } as const
const PREFIX: Record<keyof typeof QUERY, string> = { dynEq: 'PSDYNEQ ', dynVol: 'PSDYNVOL ', refLev: 'PSREFLEV ', tone: 'PSTONE CTRL ', multEq: 'PSMULTEQ:' }
const starts = (p: string) => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)

export const timing = {
  connectMs: 3000,
  replyMs: 700, // ждём ответ на запрос
  settleMs: 250, // после записи: ждём любую ответную строку
  powerMs: 2000,
  quietMs: 40,
  gapWriteMs: 60, // минимум между командами внутри сеанса
  gapSessionMs: 300, // между разными соединениями
  idleMs: 8000, // простой, после которого соединение закрывается
  cacheMs: 5000,
  inputsCacheMs: 60_000,
  rateWindowMs: 1000,
  rateMax: 4, // громкость + навигация, команд в секунду
}

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
  private lastWrite = 0
  dead = false
  constructor(private s: Sock) {
    s.on('data', (d: Buffer) => {
      this.buf += d.toString('latin1')
      this.wake?.()
    })
    s.on('error', (e: Error) => {
      this.err = e
      this.dead = true
      this.wake?.()
    })
    s.on('close', () => {
      this.dead = true
      this.wake?.()
    })
  }
  private lines = () => parseLines(this.buf)
  private async waitFor(ms: number, done: () => boolean) {
    const end = Date.now() + ms
    while (!done()) {
      if (this.err) throw mapError(this.err as NodeJS.ErrnoException)
      if (this.dead) throw new ReceiverError('Ресивер закрыл соединение', 'offline')
      const left = end - Date.now()
      if (left <= 0) return
      await new Promise<void>((res) => {
        const t = setTimeout(res, left)
        this.wake = () => {
          clearTimeout(t)
          res()
        }
      })
      this.wake = null
    }
  }
  /** Отправить команду (с паузой gapWriteMs после предыдущей); буфер ответа очищается */
  async write(cmd: string) {
    const gap = this.lastWrite + timing.gapWriteMs - Date.now()
    if (gap > 0) await sleep(gap)
    if (this.dead) throw new ReceiverError('Ресивер закрыл соединение', 'offline')
    this.buf = ''
    this.lastWrite = Date.now()
    this.s.write(`${cmd}\r`)
  }
  /** Запрос: ответная строка, подходящая под re, или null, если ресивер молчит */
  async query(cmd: string, re: RegExp, ms = timing.replyMs): Promise<string | null> {
    await this.write(cmd)
    await this.waitFor(ms, () => this.lines().some((l) => re.test(l)))
    return this.lines().find((l) => re.test(l)) ?? null
  }
  /** После записи: ждать появления строки re (или любой, если re не задан) не дольше ms; вернуть все строки */
  async settle(ms: number, re?: RegExp): Promise<string[]> {
    await this.waitFor(ms, () => (re ? this.lines().some((l) => re.test(l)) : this.lines().length > 0))
    if (!re) await sleep(timing.quietMs)
    return this.lines()
  }
  destroy() {
    this.dead = true
    this.s.destroy()
  }
}

// ---------- общий сеанс и очередь ----------
let tail: Promise<unknown> = Promise.resolve()
let conn: Session | null = null
let lastClose = 0
let idleTimer: NodeJS.Timeout | null = null

export function closeSession() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  if (conn) {
    conn.destroy()
    conn = null
    lastClose = Date.now()
  }
}

async function withSession<T>(fn: (s: Session) => Promise<T>): Promise<T> {
  const run = async () => {
    if (idleTimer) clearTimeout(idleTimer)
    if (conn?.dead) closeSession()
    try {
      if (!conn) {
        const gap = lastClose + timing.gapSessionMs - Date.now()
        if (gap > 0) await sleep(gap)
        conn = new Session(await connector())
      }
      return await fn(conn)
    } catch (e) {
      const err = mapError(e as NodeJS.ErrnoException)
      // «занят/нет связи/закрыто» — соединение негодное; ошибки уровня команды (потолок, выключен) его не рвут
      if (!['standby', 'limit', 'bad', 'rate'].includes(err.code)) closeSession()
      throw err
    } finally {
      if (conn) {
        idleTimer = setTimeout(closeSession, timing.idleMs)
        idleTimer.unref()
      }
    }
  }
  const p = tail.then(run, run)
  tail = p.catch(() => undefined)
  return p
}

// ---------- разбор ответов ----------
const pick = (line: string | null, prefix: string) => (line && line.startsWith(prefix) ? line.slice(prefix.length).trim() : null)
const RE = { pw: /^PW(ON|STANDBY)$/, mv: /^MV\d{2,3}$/, mu: /^MU(ON|OFF)$/, si: /^SI\S/, ms: /^MS\S/ }

export const parsePower = (lines: string[]): 'ON' | 'STANDBY' | null => {
  const l = lines.find((x) => RE.pw.test(x))
  return l ? (l.slice(2) as 'ON' | 'STANDBY') : null
}
/** «MV40» → 40, «MV455» → 45.5 */
export const parseVolume = (line: string | null): number | null => {
  if (!line || !RE.mv.test(line)) return null
  const d = line.slice(2)
  return d.length === 3 ? Number(d) / 10 : Number(d)
}
export const maxVolume = () => (Number.isFinite(config.marantz.maxVolume) ? config.marantz.maxVolume : 60)

// ---------- список входов и имя текущего (веб-интерфейс ресивера, GET) ----------
let inputsCache: { at: number; list: InputDef[] } | null = null
export function parseInputs(rename: string, hide: string): InputDef[] {
  const names = new Map<string, string>()
  for (const m of rename.matchAll(/name='textFuncRename(\w+)'\s+value="([^"]*)"/gi)) names.set(m[1] === 'SATCBL' ? 'SAT/CBL' : m[1], m[2].trim())
  const hidden = new Set<string>()
  for (const m of hide.matchAll(/<INPUT type='radio' name='([^']+)' value='DEL'[^>]*checked/gi)) hidden.add(m[1])
  const list: InputDef[] = []
  for (const code of INPUT_CODES) {
    if (hidden.has(code)) continue
    const name = names.get(code) ?? (code === 'TUNER' ? 'TUNER' : null)
    if (name) list.push({ code, name })
  }
  return list
}
export async function loadInputs(force = false): Promise<InputDef[]> {
  if (!force && inputsCache && Date.now() - inputsCache.at < timing.inputsCacheMs) return inputsCache.list
  const base = `http://${config.marantz.host}:${config.marantz.webPort}/SETUP/INPUTS`
  const [rename, hide] = await Promise.all([
    http(`${base}/SOURCERENAME/d_Rename.asp`, { timeoutMs: 3000 }).then((r) => r.text()),
    http(`${base}/HIDESOURCES/d_Delete.asp`, { timeoutMs: 3000 }).then((r) => r.text()),
  ])
  const list = parseInputs(rename, hide)
  if (list.length === 0) throw new ReceiverError('Не удалось получить список входов ресивера', 'offline')
  inputsCache = { at: Date.now(), list }
  return list
}
export const resetInputsCache = () => void (inputsCache = null)

// Имя текущего входа — как его показывает сам ресивер (InputFuncSelect в XML); не из таблицы кодов: код telnet и имя не всегда совпадают
async function currentInputName(): Promise<string | null> {
  try {
    const xml = await (await http(`http://${config.marantz.host}:${config.marantz.webPort}/goform/formMainZone_MainZoneXml.xml`, { timeoutMs: 1500 })).text()
    return xml.match(/<InputFuncSelect><value>([^<]*)<\/value>/)?.[1]?.replace(/&amp;/g, '&').trim() || null
  } catch {
    return null
  }
}

// ---------- чтение состояния ----------
async function readState(s: Session): Promise<ReceiverState> {
  const st: ReceiverState = { power: null, volume: null, volumeDb: null, maxVolume: maxVolume(), mute: null, input: null, inputs: [], mode: null, dynEq: null, dynVol: null, refLev: null, tone: null, multEq: null, at: Date.now() }
  st.power = parsePower([(await s.query('PW?', RE.pw)) ?? ''])
  if (st.power !== 'ON') return st // в режиме ожидания остальное не отвечает
  st.volume = parseVolume(await s.query('MV?', RE.mv))
  if (st.volume === null) return st // ресивер ещё не готов (включается) — не ждём таймауты остальных запросов
  st.volumeDb = st.volume - 80
  const mu = await s.query('MU?', RE.mu)
  st.mute = mu ? mu === 'MUON' : null
  const si = await s.query('SI?', RE.si)
  st.input = { code: si ? si.slice(2) : null, name: null }
  const ms = await s.query('MS?', RE.ms)
  st.mode = ms ? ms.slice(2) : null
  for (const k of Object.keys(QUERY) as (keyof typeof QUERY)[]) st[k] = pick(await s.query(QUERY[k], starts(PREFIX[k])), PREFIX[k])
  return st
}

async function withNames(st: ReceiverState): Promise<ReceiverState> {
  const [inputs, name] = await Promise.all([loadInputs().catch(() => [] as InputDef[]), st.power === 'ON' ? currentInputName() : null])
  st.inputs = inputs
  if (st.input) st.input.name = name ?? inputs.find((i) => i.code === st.input?.code)?.name ?? null
  return st
}

let cache: ReceiverState | null = null

/** Текущее состояние; кэш 5 с, чтобы опрос из нескольких вкладок не занимал telnet */
export async function getState(force = false): Promise<ReceiverState> {
  if (!force && cache && Date.now() - cache.at < timing.cacheMs) return cache
  const st = await withNames(await withSession(readState))
  cache = st
  return st
}

// ---------- запись: звук (ключ+значение) ----------
export type SetResult = { key: WritableKey; command: string; raw: string[]; before: string | null; after: string | null; state: ReceiverState }

export function validate(key: string, value: string): { key: WritableKey; command: string } {
  if (!Object.hasOwn(WRITABLE, key)) throw new ReceiverError('Этот параметр менять нельзя', 'bad')
  const w = WRITABLE[key as WritableKey]
  if (!(w.values as readonly string[]).includes(value)) throw new ReceiverError('Недопустимое значение', 'bad')
  return { key: key as WritableKey, command: `${w.cmd} ${value}` }
}

/** Запись из белого списка: PW? → значение «до» → команда → значение «после» (реальное, с ресивера) */
export async function setValue(key: string, value: string): Promise<SetResult> {
  const { key: k, command } = validate(key, value)
  cache = null
  const res = await withSession(async (s) => {
    const power = parsePower([(await s.query('PW?', RE.pw)) ?? ''])
    if (power !== 'ON') throw new ReceiverError('Ресивер выключен — настройки недоступны', 'standby')
    const re = starts(PREFIX[k])
    const before = pick(await s.query(QUERY[k] as string, re), PREFIX[k])
    await s.write(command)
    const raw = await s.settle(timing.settleMs)
    const after = pick(await s.query(QUERY[k] as string, re), PREFIX[k])
    return { raw, before, after }
  })
  cache = null
  return { key: k, command, ...res, state: await getState(true) }
}

// ---------- запись: пульт ----------
const stats = { ok: 0, notAccepted: 0, rate: 0, busy: 0, other: 0 }
export const getStats = () => ({ ...stats })
const recent: number[] = [] // метки времени команд громкости/навигации
export const resetRate = () => void (recent.length = 0)

function rateCheck() {
  const now = Date.now()
  while (recent.length && now - recent[0] >= timing.rateWindowMs) recent.shift()
  if (recent.length >= timing.rateMax) {
    stats.rate++
    throw new ReceiverError('Слишком часто: не больше 4 команд в секунду', 'rate')
  }
  recent.push(now)
}

export type CmdResult = {
  command: string
  cls: CmdClass
  accepted: boolean
  message: string | null
  before: string | null
  after: string | null
  volume: number | null // для громкости: значение, которое сообщил ресивер (или оценка +/−0,5)
  state: ReceiverState | null // после команд с подтверждением
}

const notAccepted = (command: string) => `Ресивер не принял команду ${command}`

export async function sendCommand(command: string): Promise<CmdResult> {
  const cls = classify(command)
  let target: InputDef | undefined
  if (cls === 'input') {
    const code = command.slice(2)
    target = (await loadInputs()).find((i) => i.code === code)
    if (!target) throw new ReceiverError('Этого входа нет в списке ресивера', 'bad')
  }
  if (cls === 'volume' || cls === 'nav') rateCheck()
  const r: CmdResult = { command, cls, accepted: true, message: null, before: null, after: null, volume: null, state: null }
  try {
    await withSession(async (s) => {
      if (cls === 'nav') {
        await s.write(command)
        return
      }
      if (cls === 'volume') {
        // потолок: свежее MV? перед каждым MVUP, кэш не используется
        if (command === 'MVUP') {
          const cur = parseVolume(await s.query('MV?', RE.mv))
          if (cur === null) {
            const pw = parsePower([(await s.query('PW?', RE.pw)) ?? ''])
            throw new ReceiverError(pw === 'STANDBY' ? 'Ресивер выключен' : 'Ресивер не ответил на запрос громкости', pw === 'STANDBY' ? 'standby' : 'timeout')
          }
          if (cur >= maxVolume()) throw new ReceiverError(`Достигнут потолок громкости (${maxVolume() - 80} dB)`, 'limit')
          r.before = String(cur)
          await s.write(command)
          const lines = await s.settle(200, RE.mv)
          r.volume = parseVolume(lines.find((l) => RE.mv.test(l)) ?? null) ?? cur + 0.5
        } else {
          await s.write(command)
          const lines = await s.settle(200, RE.mv)
          r.volume = parseVolume(lines.find((l) => RE.mv.test(l)) ?? null)
        }
        return
      }
      // команды с подтверждением: «до», запись, ожидание, «после»
      const pw = parsePower([(await s.query('PW?', RE.pw)) ?? ''])
      r.before = pw
      if (cls === 'power') {
        const want = command === 'PWON' ? 'ON' : 'STANDBY'
        await s.write(command)
        await s.settle(timing.powerMs, new RegExp(`^PW${want}$`))
        r.after = parsePower([(await s.query('PW?', RE.pw)) ?? ''])
        r.accepted = r.after === want
      } else {
        if (pw !== 'ON') throw new ReceiverError('Ресивер выключен — команды недоступны', 'standby')
        if (cls === 'mute') {
          r.before = (await s.query('MU?', RE.mu)) ?? null
          await s.write(command)
          await s.settle(timing.settleMs)
          r.after = (await s.query('MU?', RE.mu)) ?? null
          r.accepted = r.after === command
        } else if (cls === 'mode') {
          r.before = (await s.query('MS?', RE.ms)) ?? null
          await s.write(command)
          await s.settle(timing.settleMs)
          r.after = (await s.query('MS?', RE.ms)) ?? null
          // «Movie» может превратиться в конкретный декодер, поэтому достаточно, что режим изменился
          r.accepted = r.after !== null && (r.after === command || r.after !== r.before)
        } else if (cls === 'input') {
          r.before = (await s.query('SI?', RE.si)) ?? null
          await s.write(command)
          await s.settle(timing.settleMs)
          r.after = (await s.query('SI?', RE.si)) ?? null
          r.accepted = r.after === command
        } else {
          // Quick Select: прочитать результат нечем — считаем принятой, если ресивер что-то ответил
          await s.write(command)
          r.accepted = (await s.settle(600)).length > 0
        }
      }
      if (cls !== 'quick' || r.accepted) r.state = await readState(s)
    })
  } catch (e) {
    if ((e as ReceiverError).code === 'busy') stats.busy++
    else if (!['rate'].includes((e as ReceiverError).code)) stats.other++
    throw e
  }
  cache = null
  if (r.state) {
    r.state = await withNames(r.state)
    cache = r.state
    // имя входа от самого ресивера надёжнее кода: «ANDROID» может приходить как SIBD
    if (cls === 'input' && !r.accepted && target && r.state.input?.name === target.name) r.accepted = true
  }
  if (!r.accepted) {
    r.message = notAccepted(command)
    stats.notAccepted++
  } else stats.ok++
  return r
}
