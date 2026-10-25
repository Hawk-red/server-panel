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

export const timing = { probeMs: 1500, statusCacheMs: 3000, connectMs: 5000, pairMs: 30_000, sendMs: 1500, rateWindowMs: 1000, rateMax: 5 }

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

// ---------- токен ----------
const TOKEN_KEY = 'tv.token'
const PAIRED_KEY = 'tv.paired'
const readToken = (): string | null => {
  const blob = getSetting<string | null>(TOKEN_KEY, null)
  if (!blob) return null
  try {
    return decryptSecret(blob)
  } catch {
    return null
  }
}
const saveToken = (t: string) => {
  setSetting(TOKEN_KEY, encryptSecret(t))
  setSetting(PAIRED_KEY, true)
}
export const isPaired = () => getSetting<boolean>(PAIRED_KEY, false)
export const forgetPairing = () => {
  setSetting(TOKEN_KEY, null)
  setSetting(PAIRED_KEY, false)
}

// ---------- статус ----------
export type TvStatus = { online: boolean; port: 8001 | 8002 | null; paired: boolean; host: string; at: number }
let statusCache: TvStatus | null = null
export const resetStatus = () => void (statusCache = null)

export async function getStatus(force = false): Promise<TvStatus> {
  if (!force && statusCache && Date.now() - statusCache.at < timing.statusCacheMs) return { ...statusCache, paired: isPaired() }
  const [p2, p1] = await Promise.all([probe(config.tv.host, 8002, timing.probeMs), probe(config.tv.host, 8001, timing.probeMs)])
  statusCache = { online: p1 || p2, port: p2 ? 8002 : p1 ? 8001 : null, paired: isPaired(), host: config.tv.host, at: Date.now() }
  return statusCache
}

// ---------- сокет ----------
const NAME = Buffer.from('ServerPanel').toString('base64')
const urlFor = (port: 8001 | 8002, token: string | null) =>
  `${port === 8002 ? 'wss' : 'ws'}://${config.tv.host}:${port}/api/v2/channels/samsung.remote.api.v2?name=${NAME}${token ? `&token=${encodeURIComponent(token)}` : ''}`

const wsErr = (e: unknown) => new TvError(`Ошибка связи с телевизором: ${errText(e)}`, 'offline')

/** Открыть сокет и дождаться ms.channel.connect; вернуть сокет и токен из ответа (если ТВ его выдал) */
function open(port: 8001 | 8002, token: string | null, waitMs: number): Promise<{ ws: WsLike; token: string | null }> {
  return new Promise((resolve, reject) => {
    let ws: WsLike
    try {
      ws = factory(urlFor(port, token))
    } catch (e) {
      return reject(wsErr(e))
    }
    let settled = false
    const fail = (e: TvError) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws.terminate()
      } catch {
        /* уже закрыт */
      }
      reject(e)
    }
    const timer = setTimeout(
      () => fail(new TvError(waitMs === timing.pairMs ? 'Телевизор не подтвердил сопряжение за 30 с: нажмите «Разрешить» на экране ТВ' : 'Телевизор не ответил на подключение', 'timeout')),
      waitMs,
    )
    ws.on('message', (d) => {
      let m: { event?: string; data?: { token?: string } }
      try {
        m = JSON.parse(d.toString())
      } catch {
        return
      }
      if (m.event === 'ms.channel.connect' && !settled) {
        settled = true
        clearTimeout(timer)
        resolve({ ws, token: typeof m.data?.token === 'string' ? m.data.token : null })
      } else if (m.event === 'ms.channel.unauthorized' || m.event === 'ms.channel.timeOut') {
        fail(new TvError(m.event === 'ms.channel.timeOut' ? 'Телевизор не получил разрешения за отведённое время' : 'Телевизор не разрешил управление: выполните сопряжение заново', 'denied'))
      }
    })
    ws.on('error', (e) => fail(wsErr(e)))
    ws.on('close', () => fail(new TvError('Телевизор закрыл соединение', 'offline')))
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

export type KeyResult = { key: string; port: number }

export async function sendKey(key: string): Promise<KeyResult> {
  if (!isKey(key)) throw new TvError('Эта кнопка недопустима', 'bad')
  rateCheck()
  return queued(async () => {
    const st = await getStatus()
    if (!st.online || !st.port) throw new TvError('Телевизор не отвечает в сети', 'offline')
    const token = readToken()
    if (!token && !isPaired()) throw new TvError('Телевизор ещё не сопряжён: нажмите «Сопрячь» и разрешите на экране ТВ', 'unpaired')
    const ports = st.port === 8002 && (await probe(config.tv.host, 8001, timing.probeMs)) ? [8002, 8001] : [st.port]
    let last: unknown
    for (const port of ports as (8001 | 8002)[]) {
      try {
        const { ws, token: fresh } = await open(port, token, timing.connectMs)
        try {
          if (fresh && fresh !== token) saveToken(fresh)
          await send(ws, key)
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

/** Сопряжение: ТВ показывает на экране «Разрешить»; полученный токен сохраняется, наружу не отдаётся */
export async function pair(): Promise<{ paired: true }> {
  return queued(async () => {
    const st = await getStatus(true)
    if (!st.online || !st.port) throw new TvError('Телевизор не отвечает в сети: включите его и повторите', 'offline')
    const { ws, token } = await open(st.port, null, timing.pairMs)
    try {
      saveToken(token ?? '')
    } finally {
      try {
        ws.close()
      } catch {
        /* закрыт */
      }
    }
    statusCache = null
    return { paired: true as const }
  })
}
