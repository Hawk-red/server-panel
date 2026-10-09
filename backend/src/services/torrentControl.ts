// «Остановить все / Запустить все» для торрентов. В отличие от hashes=all, панель запоминает, КАКИЕ торренты остановила сама
// (список хешей в panel.db переживает перезапуск панели), и «Запустить все» возобновляет только их: поставленные вами вручную
// торренты остаются остановленными. Ничего не удаляется.
import { getSetting, setSetting } from '../settings.js'
import * as qbt from './qbittorrent.js'

const KEY = 'torrents.panelStopped'

export type Qbt = Pick<typeof qbt, 'listTorrents' | 'stopHashes' | 'startHashes'>

export const panelStoppedHashes = () => getSetting<string[]>(KEY, [])

export async function panelStoppedInfo(api: Qbt = qbt) {
  const set = new Set(panelStoppedHashes())
  const all = await api.listTorrents()
  const mine = all.filter((t) => set.has(t.hash) && qbt.isStoppedState(t.state))
  return { count: mine.length, names: mine.slice(0, 20).map((t) => t.name), stoppedManually: all.filter((t) => qbt.isStoppedState(t.state) && !set.has(t.hash)).length }
}

export async function stopAllTorrents(api: Qbt = qbt) {
  const all = await api.listTorrents()
  const targets = all.filter((t) => !qbt.isStoppedState(t.state))
  if (targets.length) {
    // сначала запоминаем, потом останавливаем: упавший посередине вызов не оставит «чужих» остановленных торрентов
    setSetting(KEY, [...new Set([...panelStoppedHashes(), ...targets.map((t) => t.hash)])])
    await api.stopHashes(targets.map((t) => t.hash))
  }
  return { stopped: targets.length, alreadyStopped: all.length - targets.length, total: all.length }
}

export async function startPanelStopped(api: Qbt = qbt) {
  const set = new Set(panelStoppedHashes())
  const all = await api.listTorrents()
  const toStart = all.filter((t) => set.has(t.hash) && qbt.isStoppedState(t.state))
  if (toStart.length) await api.startHashes(toStart.map((t) => t.hash))
  setSetting(KEY, [])
  return {
    started: toStart.length,
    leftStoppedManually: all.filter((t) => qbt.isStoppedState(t.state) && !set.has(t.hash)).length, // остановлены не панелью — не тронуты
    forgotten: set.size - toStart.length, // запомненные, но уже запущенные вами или удалённые
  }
}

// Вернуть в общий список «остановлено панелью» (например, если возобновление после обновления не удалось)
export function rememberStopped(hashes: string[]) {
  setSetting(KEY, [...new Set([...panelStoppedHashes(), ...hashes])])
}
