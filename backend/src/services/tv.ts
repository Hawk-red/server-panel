// Телевизор Samsung: статус (TCP 8001/8002) и ключи пульта по WebSocket (samsung.remote.api.v2).
// Каждая команда — короткая сессия (подключился → отправил ключ → закрыл). Токен сопряжения хранится зашифрованным
// в настройках панели и наружу не выдаётся: ни в ответах API, ни в журналах (ошибки проходят через mask.ts).
import net from 'node:net'
import WebSocket from 'ws'
import { config } from '../config.js'
import { errText } from '../mask.js'
import { decryptSecret, encryptSecret } from '../secretbox.js'
import { getSetting, setSetting } from '../settings.js'

export class TvError extends Error {
  constructor(
    message: string,
    public code: 'offline' | 'unpaired' | 'denied' | 'rate' | 'timeout' | 'bad',
  ) {
    super(message)
  }
}

/**
 * Белый список ключей. false — имя ключа взято из общедоступных таблиц Samsung/сообщества, но на этом телевизоре
 * не проверялось (ТВ был выключен): помечается «не проверено» в окне выбора команды и в README.
 */
export const KEYS: Record<string, { title: string; verified: boolean }> = {
  KEY_POWER: { title: 'Питание', verified: true },
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`KEY_${i}`, { title: `Цифра ${i}`, verified: true }])),
  KEY_SOURCE: { title: 'Источник', verified: true },
  KEY_VOLUP: { title: 'Громкость +', verified: true },
  KEY_VOLDOWN: { title: 'Громкость −', verified: true },
  KEY_MUTE: { title: 'Mute', verified: true },
  KEY_CHUP: { title: 'Канал ▲ (P+)', verified: true },
  KEY_CHDOWN: { title: 'Канал ▼ (P−)', verified: true },
  KEY_CH_LIST: { title: 'Список каналов (CH LIST)', verified: false },
  KEY_PRECH: { title: 'Предыдущий канал (PRE-CH)', verified: true },
  KEY_TTX_MIX: { title: 'Телетекст / MIX (TTX/MIX)', verified: false },
  KEY_CONTENTS: { title: 'Контент (CONTENT)', verified: false },
  KEY_MENU: { title: 'Меню', verified: true },
  KEY_GUIDE: { title: 'Гид (GUIDE)', verified: true },
  KEY_TOOLS: { title: 'Инструменты (TOOLS)', verified: true },
  KEY_INFO: { title: 'Информация (INFO)', verified: true },
  KEY_UP: { title: 'Вверх', verified: true },
  KEY_DOWN: { title: 'Вниз', verified: true },
  KEY_LEFT: { title: 'Влево', verified: true },
  KEY_RIGHT: { title: 'Вправо', verified: true },
  KEY_ENTER: { title: 'Ввод (ENTER)', verified: true },
  KEY_RETURN: { title: 'Назад (RETURN)', verified: true },
  KEY_EXIT: { title: 'Выход (EXIT)', verified: true },
  KEY_RED: { title: 'Красная (A)', verified: true },
  KEY_GREEN: { title: 'Зелёная (B)', verified: true },
  KEY_YELLOW: { title: 'Жёлтая (C)', verified: true },
  KEY_CYAN: { title: 'Синяя (D) — у Samsung ключ называется CYAN', verified: true },
  KEY_EMANUAL: { title: 'E-MANUAL', verified: false },
  KEY_PICTURE_SIZE: { title: 'Размер картинки (P.SIZE)', verified: false },
  KEY_AD: { title: 'Аудиоописание / субтитры (AD/SUBT.)', verified: false },
  // Документированные замены для двух кнопок: имени KEY_EMANUAL в таблицах Samsung нет — кнопку E-MANUAL пультов серии AA59
  // там обозначают KEY_TOPMENU, а вторую роль AD/SUBT. (субтитры) — KEY_CAPTION. Умолчания кнопок не меняются:
  // если KEY_EMANUAL/KEY_AD на этом ТВ не сработают, кнопку можно перевесить в режиме «Настроить пульт».
  KEY_TOPMENU: { title: 'Верхнее меню — так обозначают E-MANUAL пультов AA59', verified: false },
  KEY_CAPTION: { title: 'Субтитры — вторая роль кнопки AD/SUBT.', verified: false },
  KEY_STOP: { title: 'Стоп', verified: true },
  KEY_REWIND: { title: 'Перемотка назад', verified: true },
  KEY_PLAY: { title: 'Воспроизведение', verified: true },
  KEY_PAUSE: { title: 'Пауза', verified: true },
  KEY_FF: { title: 'Перемотка вперёд', verified: true },
}
export const isKey = (k: unknown): k is string => typeof k === 'string' && Object.hasOwn(KEYS, k)
/** Без записи в журнал: слишком частые */
export const QUIET_KEYS = new Set(['KEY_VOLUP', 'KEY_VOLDOWN', 'KEY_UP', 'KEY_DOWN', 'KEY_LEFT', 'KEY_RIGHT'])

// lateTokenMs — сколько ждать токен после connect без токена; afterSendMs — пауза перед закрытием сокета, чтобы ТВ успел выполнить команду
export const timing = { probeMs: 1500, statusCacheMs: 3000, connectMs: 5000, pairMs: 30_000, lateTokenMs: 10_000, sendMs: 1500, afterSendMs: 600, rateWindowMs: 1000, rateMax: 5, infoMs: 3000, infoCacheMs: 60_000 }

// ---------- подмена сети для тестов ----------
export type WsLike = {
  on(ev: 'message', fn: (d: { toString(): string }) => void): unknown
  on(ev: 'error' | 'close', fn: (e?: Error) => void): unknown
  send(data: string, cb?: (e?: Error) => void): void
  close(): void
  terminate(): void
}
export type WsFactory = (url: string) => WsLike
export type Probe = (host: string, port: number, ms: number) => Promise<boolean>

const defaultFactory: WsFactory = (url) => new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: timing.connectMs }) as unknown as WsLike
const defaultProbe: Probe = (host, port, ms) =>
  new Promise((resolve) => {
    const s = net.createConnection({ host, port })
    const done = (ok: boolean) => {
      s.destroy()
      resolve(ok)
    }
    s.setTimeout(ms, () => done(false))
    s.once('connect', () => done(true))
    s.once('error', () => done(false))
  })
let factory: WsFactory = defaultFactory
let probe: Probe = defaultProbe
export const setWsFactory = (f: WsFactory | null) => void (factory = f ?? defaultFactory)
export const setProbe = (p: Probe | null) => void (probe = p ?? defaultProbe)

// ---------- сведения о телевизоре ----------
// TokenAuthSupport из GET http://ТВ:8001/api/v2/ решает, нужен ли токен: современные Tizen (true) без токена
// команды молча игнорируют, старые модели (false) принимают их и так.
export type TvInfo = { tokenAuth: boolean | null; model: string | null }
export type InfoFetch = (url: string, ms: number) => Promise<unknown>
const defaultInfoFetch: InfoFetch = async (url, ms) => (await fetch(url, { signal: AbortSignal.timeout(ms) })).json()
let infoFetch: InfoFetch = defaultInfoFetch
export const setInfoFetch = (f: InfoFetch | null) => void (infoFetch = f ?? defaultInfoFetch)

let infoCache: { at: number; v: TvInfo } | null = null
export const resetInfo = () => void (infoCache = null)

/** Что ТВ рассказывает о себе. Не ответил — tokenAuth: null (считаем, что токен нужен: так безопаснее) */
export async function deviceInfo(): Promise<TvInfo> {
  if (infoCache && Date.now() - infoCache.at < timing.infoCacheMs) return infoCache.v
  let v: TvInfo = { tokenAuth: null, model: null }
  try {
    const j = (await infoFetch(`http://${config.tv.host}:8001/api/v2/`, timing.infoMs)) as { device?: { TokenAuthSupport?: unknown; modelName?: unknown } }
    const d = j?.device ?? {}
    v = { tokenAuth: d.TokenAuthSupport === undefined ? null : d.TokenAuthSupport === true || d.TokenAuthSupport === 'true', model: typeof d.modelName === 'string' ? d.modelName : null }
  } catch {
    /* ТВ не ответил: решаем по сохранённому режиму сопряжения */
  }
  infoCache = { at: Date.now(), v }
  return v
}

// ---------- токен и режим сопряжения ----------
const TOKEN_KEY = 'tv.token'
const MODE_KEY = 'tv.pairMode' // 'token' — ТВ выдал токен; 'open' — ТВ токенов не требует (старые модели)
const LEGACY_PAIRED_KEY = 'tv.paired' // осталось от первой версии, где «сопряжением» считалось само открытие сокета

export type PairMode = 'token' | 'open' | null
const pairMode = (): PairMode => {
  const m = getSetting<string | null>(MODE_KEY, null)
  return m === 'token' || m === 'open' ? m : null
}
const readToken = (): string | null => {
  const blob = getSetting<string | null>(TOKEN_KEY, null)
  if (!blob) return null
  try {
    return decryptSecret(blob) || null // пустой токен — не токен
  } catch {
    return null
  }
}
const saveToken = (t: string) => {
  setSetting(TOKEN_KEY, encryptSecret(t))
  setSetting(MODE_KEY, 'token')
  setSetting(LEGACY_PAIRED_KEY, null)
}
const saveOpenMode = () => {
  setSetting(TOKEN_KEY, null)
  setSetting(MODE_KEY, 'open')
  setSetting(LEGACY_PAIRED_KEY, null)
}
/** Сопряжён — только если есть токен или ТВ его не требует. Открытого сокета мало: ТВ пускает всех, а команды игнорирует */
export const isPaired = () => pairMode() === 'open' || readToken() !== null
export const forgetPairing = () => {
  setSetting(TOKEN_KEY, null)
  setSetting(MODE_KEY, null)
  setSetting(LEGACY_PAIRED_KEY, null)
}

// Что делать владельцу на телевизоре, если тот не выдаёт разрешения
const TV_MENU = 'На телевизоре: Настройки → Общие → Менеджер внешних устройств → Менеджер подключения устройств → «Уведомление о доступе» включить, а в «Списке устройств» удалить запись панели'
const NO_TOKEN_MSG = `Телевизор принял подключение, но управление не разрешил: окно «Разрешить» не появилось и токен не выдан. ${TV_MENU}. Потом снова нажмите «Сопрячь» и подтвердите окно на экране ТВ.`
const DENIED_MSG = `Телевизор запретил управление панелью. ${TV_MENU}. Потом снова нажмите «Сопрячь» и подтвердите окно на экране ТВ.`
const UNPAIRED_MSG = `Телевизор не сопряжён: нет токена, без него команды он молча игнорирует. Нажмите «Сопрячь» и подтвердите окно на экране ТВ. Если окно не появляется — ${TV_MENU}.`

// ---------- статус ----------
export type TvStatus = { online: boolean; port: 8001 | 8002 | null; paired: boolean; tokenAuth: boolean | null; host: string; at: number }
let statusCache: TvStatus | null = null
export const resetStatus = () => void (statusCache = null)

export async function getStatus(force = false): Promise<TvStatus> {
  if (!force && statusCache && Date.now() - statusCache.at < timing.statusCacheMs) return { ...statusCache, paired: isPaired() }
  const [p2, p1] = await Promise.all([probe(config.tv.host, 8002, timing.probeMs), probe(config.tv.host, 8001, timing.probeMs)])
  const online = p1 || p2
  const info = online ? await deviceInfo() : { tokenAuth: null, model: null }
  statusCache = { online, port: p2 ? 8002 : p1 ? 8001 : null, paired: isPaired(), tokenAuth: info.tokenAuth, host: config.tv.host, at: Date.now() }
  return statusCache
}

// ---------- сокет ----------
const NAME = Buffer.from('ServerPanel').toString('base64')
const urlFor = (port: 8001 | 8002, token: string | null) =>
  `${port === 8002 ? 'wss' : 'ws'}://${config.tv.host}:${port}/api/v2/channels/samsung.remote.api.v2?name=${NAME}${token ? `&token=${encodeURIComponent(token)}` : ''}`

const wsErr = (e: unknown) => new TvError(`Ошибка связи с телевизором: ${errText(e)}`, 'offline')
const parse = (d: { toString(): string }): { event?: string; data?: { token?: unknown; message?: unknown } } | null => {
  try {
    return JSON.parse(d.toString())
  } catch {
    return null
  }
}

/**
 * Открыть сокет и дождаться ms.channel.connect.
 * waitToken — для сопряжения: ТВ присылает connect сразу, а токен только после «Разрешить» на экране,
 * поэтому после connect без токена ждём ещё lateTokenMs и лишь затем отвечаем «токена нет».
 */
function open(port: 8001 | 8002, token: string | null, waitMs: number, waitToken = false): Promise<{ ws: WsLike; token: string | null }> {
  return new Promise((resolve, reject) => {
    let ws: WsLike
    try {
      ws = factory(urlFor(port, token))
    } catch (e) {
      return reject(wsErr(e))
    }
    let settled = false
    let late: ReturnType<typeof setTimeout> | null = null
    const stop = () => {
      clearTimeout(timer)
      if (late) clearTimeout(late)
    }
    const done = (t: string | null) => {
      if (settled) return
      settled = true
      stop()
      resolve({ ws, token: t })
    }
    const fail = (e: TvError) => {
      if (settled) return
      settled = true
      stop()
      try {
        ws.terminate()
      } catch {
        /* уже закрыт */
      }
      reject(e)
    }
    const timer = setTimeout(
      () => fail(new TvError(waitToken ? 'Телевизор не подтвердил сопряжение за 30 с: нажмите «Разрешить» на экране ТВ' : 'Телевизор не ответил на подключение', 'timeout')),
      waitMs,
    )
    ws.on('message', (d) => {
      const m = parse(d)
      if (!m) return
      if (m.event === 'ms.channel.connect') {
        const t = typeof m.data?.token === 'string' && m.data.token ? m.data.token : null
        if (t || !waitToken) return done(t)
        if (!late) late = setTimeout(() => done(null), timing.lateTokenMs)
      } else if (m.event === 'ms.channel.unauthorized' || m.event === 'ms.channel.timeOut') {
        fail(new TvError(m.event === 'ms.channel.timeOut' ? 'Телевизор не получил разрешения за отведённое время' : DENIED_MSG, 'denied'))
      }
    })
    ws.on('error', (e) => fail(wsErr(e)))
    ws.on('close', () => (late ? done(null) : fail(new TvError('Телевизор закрыл соединение', 'offline'))))
  })
}

let tail: Promise<unknown> = Promise.resolve()
const queued = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = tail.then(fn, fn)
  tail = p.catch(() => undefined)
  return p
}

const recent: number[] = []
export const resetRate = () => void (recent.length = 0)
function rateCheck() {
  const now = Date.now()
  while (recent.length && now - recent[0] >= timing.rateWindowMs) recent.shift()
  if (recent.length >= timing.rateMax) throw new TvError('Слишком часто: не больше 5 команд телевизору в секунду', 'rate')
  recent.push(now)
}

const send = (ws: WsLike, key: string) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new TvError('Телевизор не принял команду', 'timeout')), timing.sendMs)
    ws.send(JSON.stringify({ method: 'ms.remote.control', params: { Cmd: 'Click', DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' } }), (e) => {
      clearTimeout(t)
      e ? reject(wsErr(e)) : resolve()
    })
  })

/** После отправки держим сокет ещё afterSendMs: ТВ успевает выполнить команду, а если откажет — присылает ошибку */
const settle = (ws: WsLike) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, timing.afterSendMs)
    ws.on('message', (d) => {
      const m = parse(d)
      if (!m) return
      if (m.event === 'ms.channel.unauthorized') {
        clearTimeout(t)
        reject(new TvError(DENIED_MSG, 'denied'))
      } else if (m.event === 'ms.error') {
        clearTimeout(t)
        reject(new TvError(`Телевизор отклонил команду: ${typeof m.data?.message === 'string' ? m.data.message : 'причина не указана'}`, 'denied'))
      }
    })
  })

export type KeyResult = { key: string; port: number }

export async function sendKey(key: string): Promise<KeyResult> {
  if (!isKey(key)) throw new TvError('Эта кнопка недопустима', 'bad')
  rateCheck()
  return queued(async () => {
    const st = await getStatus()
    if (!st.online || !st.port) throw new TvError('Телевизор не отвечает в сети', 'offline')
    const token = readToken()
    if (!token && pairMode() !== 'open') throw new TvError(UNPAIRED_MSG, 'unpaired')
    const ports = st.port === 8002 && (await probe(config.tv.host, 8001, timing.probeMs)) ? [8002, 8001] : [st.port]
    let last: unknown
    for (const port of ports as (8001 | 8002)[]) {
      try {
        const { ws, token: fresh } = await open(port, token, timing.connectMs)
        try {
          if (fresh && fresh !== token) saveToken(fresh)
          await send(ws, key)
          await settle(ws)
          return { key, port }
        } finally {
          try {
            ws.close()
          } catch {
            /* закрыт */
          }
        }
      } catch (e) {
        last = e
        if (e instanceof TvError && (e.code === 'denied' || e.code === 'bad')) throw e
      }
    }
    statusCache = null
    throw last instanceof TvError ? last : wsErr(last)
  })
}

/**
 * Сопряжение. Успех — только если ТВ выдал токен (владелец нажал «Разрешить» на экране) либо токенов не требует.
 * Открытый сокет сам по себе ничего не значит: Tizen пускает любого, а команды без токена молча игнорирует.
 */
export async function pair(): Promise<{ paired: true; mode: 'token' | 'open' }> {
  return queued(async () => {
    const st = await getStatus(true)
    if (!st.online || !st.port) throw new TvError('Телевизор не отвечает в сети: включите его и повторите', 'offline')
    const info = await deviceInfo()
    const { ws, token } = await open(st.port, null, timing.pairMs, true)
    try {
      if (token) {
        saveToken(token)
        return { paired: true as const, mode: 'token' as const }
      }
      if (info.tokenAuth === false) {
        saveOpenMode() // старая модель: токенов не знает, команды принимает и так
        return { paired: true as const, mode: 'open' as const }
      }
      forgetPairing()
      throw new TvError(NO_TOKEN_MSG, 'denied')
    } finally {
      statusCache = null
      try {
        ws.close()
      } catch {
        /* закрыт */
      }
    }
  })
}
