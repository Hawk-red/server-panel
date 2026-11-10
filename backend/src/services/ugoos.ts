// Android TV бокс UGOOS SK1: статус и отправка ключей пульта напрямую по ADB (без Home Assistant — тот только
// путал дело: ADB-сессия между HA и боксом сама рвётся от сна/Wi-Fi, и HA из-за этого считал кнопки «недоступны»,
// хотя ручной `adb -s <host:port> shell input keyevent ...` с этого же сервера прекрасно работал).
import { config } from '../config.js'
import { ExecError, run } from '../exec.js'
import { errText } from '../mask.js'
import { TvError } from './tv.js'

export { TvError }

/** Белый список ключей: android keyevent-имена без префикса KEYCODE_ (D-pad/HOME/BACK/MENU), плюс громкость/mute/питание */
export const KEYS: Record<string, { title: string; verified: boolean }> = {
  POWER: { title: 'Питание', verified: true },
  HOME: { title: 'Домой', verified: true },
  BACK: { title: 'Назад', verified: true },
  MENU: { title: 'Меню', verified: true },
  DPAD_UP: { title: 'Вверх', verified: true },
  DPAD_DOWN: { title: 'Вниз', verified: true },
  DPAD_LEFT: { title: 'Влево', verified: true },
  DPAD_RIGHT: { title: 'Вправо', verified: true },
  DPAD_CENTER: { title: 'OK (центр)', verified: true },
  VOL_UP: { title: 'Громкость +', verified: true },
  VOL_DOWN: { title: 'Громкость −', verified: true },
  MUTE: { title: 'Mute', verified: true },
}
export const isKey = (k: unknown): k is string => typeof k === 'string' && Object.hasOwn(KEYS, k)
/** Без записи в журнал: слишком частые */
export const QUIET_KEYS = new Set(['VOL_UP', 'VOL_DOWN', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT'])

/** Ключ -> полный android keyevent (с префиксом KEYCODE_), который реально уходит в `adb shell input keyevent` */
const KEYCODES: Record<string, string> = {
  POWER: 'KEYCODE_POWER',
  HOME: 'KEYCODE_HOME',
  BACK: 'KEYCODE_BACK',
  MENU: 'KEYCODE_MENU',
  DPAD_UP: 'KEYCODE_DPAD_UP',
  DPAD_DOWN: 'KEYCODE_DPAD_DOWN',
  DPAD_LEFT: 'KEYCODE_DPAD_LEFT',
  DPAD_RIGHT: 'KEYCODE_DPAD_RIGHT',
  DPAD_CENTER: 'KEYCODE_DPAD_CENTER',
  VOL_UP: 'KEYCODE_VOLUME_UP',
  VOL_DOWN: 'KEYCODE_VOLUME_DOWN',
  MUTE: 'KEYCODE_VOLUME_MUTE',
}

const serial = () => `${config.ugoos.host}:${config.ugoos.port}`

// Подменяемый исполнитель adb (тесты подставляют подставной adb, настоящий бокс не трогают)
type Runner = (args: string[], opts?: { timeoutMs?: number }) => Promise<string>
export const deps: { run: Runner } = { run: (args, opts) => run('adb', args, opts) }

const adbErr = (e: unknown): TvError => {
  if (e instanceof ExecError) {
    if (e.code === 'ENOENT') return new TvError('На сервере не найден adb (команда не установлена)', 'offline')
    if (e.code === 'ETIMEDOUT') return new TvError('Бокс не ответил по ADB (таймаут)', 'offline')
    return new TvError(`Бокс не выполнил ADB-команду: ${errText(e)}`, 'offline')
  }
  return new TvError(`Ошибка связи с боксом по ADB: ${errText(e)}`, 'offline')
}

// adb connect перед командой — подстраховка на случай разрыва сессии (бокс спал, Wi-Fi мигнул), не чаще раза
// в CONNECT_CACHE_MS. Неудачный connect НЕ блокирует саму команду — пробуем keyevent всё равно: вдруг сессия
// и так жива, а если бокс правда недоступен, понятная ошибка придёт от самой команды (как у ИК-пульта)
const CONNECT_CACHE_MS = 30_000
let lastConnectAt = 0
export const resetConnectCache = () => void (lastConnectAt = 0)

async function ensureConnected(): Promise<void> {
  if (Date.now() - lastConnectAt < CONNECT_CACHE_MS) return
  lastConnectAt = Date.now()
  try {
    await deps.run(['connect', serial()], { timeoutMs: 5000 })
  } catch {
    /* не страшно — пробуем команду всё равно, см. комментарий выше */
  }
}

export type UgoosStatus = { online: boolean; keys: string[]; at: number }
const STATUS_CACHE_MS = 3000
let statusCache: UgoosStatus | null = null
export const resetStatus = () => void (statusCache = null)

/** Лёгкая проверка «в сети» для индикатора в интерфейсе — на отправку команд не влияет, только на бейдж статуса */
export async function getStatus(force = false): Promise<UgoosStatus> {
  if (!force && statusCache && Date.now() - statusCache.at < STATUS_CACHE_MS) return statusCache
  let online = false
  try {
    const out = await deps.run(['-s', serial(), 'get-state'], { timeoutMs: 4000 })
    online = out.trim() === 'device'
  } catch {
    online = false
  }
  return (statusCache = { online, keys: Object.keys(KEYS), at: Date.now() })
}

export type KeyResult = { key: string; via: string }

/** Команда отправляется для любого ключа из белого списка независимо от текущего статуса — как у ИК-пульта,
 *  бокс часто уходит в сон и выпадает из сети, и раньше (через HA) это полностью блокировало кнопку */
export async function sendKey(key: string): Promise<KeyResult> {
  if (!isKey(key)) throw new TvError('Эта кнопка недопустима', 'bad')
  const keycode = KEYCODES[key]
  await ensureConnected()
  try {
    await deps.run(['-s', serial(), 'shell', 'input', 'keyevent', keycode], { timeoutMs: 8000 })
  } catch (e) {
    throw adbErr(e)
  }
  statusCache = null // бокс мог включиться/выключиться — следующий статус перечитать заново
  return { key, via: `ADB, ${keycode}` }
}
