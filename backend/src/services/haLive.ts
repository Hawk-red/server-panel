import WebSocket from 'ws'
import { errText } from '../mask.js'
import { guardedLookup, parseUrl } from './smarthomeCore.js'
import { CONTROL_DOMAINS, SCENE_DOMAIN } from './haClient.js'

// Живые события Home Assistant: подписка на state_changed по WebSocket. Только чтение; наружу отдаются лишь entity_id и состояние сущностей
// из белого списка (switch, light, scene). Токен нигде не логируется. При обрыве — переподключение с нарастающей паузой.

export type LiveEvent = { entityId: string; state: string }

const WATCH = new Set<string>([...CONTROL_DOMAINS, SCENE_DOMAIN])

// Из сообщения WebSocket — событие state_changed белого списка (или null)
export function parseStateChanged(m: unknown): LiveEvent | null {
  const msg = m as { type?: unknown; event?: { event_type?: unknown; data?: { entity_id?: unknown; new_state?: { state?: unknown } | null } } }
  if (msg?.type !== 'event' || msg.event?.event_type !== 'state_changed') return null
  const id = msg.event.data?.entity_id
  const state = msg.event.data?.new_state?.state
  if (typeof id !== 'string' || typeof state !== 'string' || !WATCH.has(id.split('.')[0]) || !/^[a-z_]+\.[a-z0-9_]+$/.test(id)) return null
  return { entityId: id, state }
}

export const BACKOFF_START_MS = 1000
export const BACKOFF_MAX_MS = 60_000
export const nextBackoff = (ms: number) => Math.min(ms * 2, BACKOFF_MAX_MS)

type Sock = Pick<WebSocket, 'on' | 'send' | 'close' | 'removeAllListeners'>
export type LiveOpts = {
  url: string
  token: string
  onEvent: (e: LiveEvent) => void
  onConnected: (up: boolean) => void // true — подписка активна; false — связь потеряна (вернуться к опросу)
  log?: (msg: string) => void
  connect?: (wsUrl: string) => Sock
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
}

export function startHaLive(opts: LiveOpts): { stop: () => void } {
  const u = parseUrl(opts.url)
  if (!u || !opts.token) return { stop: () => undefined }
  const wsUrl = `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}/api/websocket`
  const connect = opts.connect ?? ((url: string) => new WebSocket(url, { lookup: guardedLookup(), handshakeTimeout: 8000, maxPayload: 32 * 1024 * 1024 }))
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as NodeJS.Timeout))
  let stopped = false
  let backoff = BACKOFF_START_MS
  let timer: unknown = null
  let ws: Sock | null = null
  let wasUp = false

  const lost = (why: string) => {
    if (ws) {
      ws.removeAllListeners()
      ws.on('error', () => undefined)
      try {
        ws.close()
      } catch {
        /* уже закрыт */
      }
      ws = null
    }
    if (wasUp) {
      wasUp = false
      opts.onConnected(false)
    }
    if (stopped || timer) return
    opts.log?.(`Home Assistant live: ${why}; повтор через ${Math.round(backoff / 1000)} с`)
    timer = setTimer(() => {
      timer = null
      open()
    }, backoff)
    backoff = nextBackoff(backoff)
  }

  const open = () => {
    if (stopped) return
    let s: Sock
    try {
      s = connect(wsUrl)
    } catch (e) {
      return lost(errText(e).split('\n')[0])
    }
    ws = s
    s.on('error', (e: unknown) => lost(errText(e).split('\n')[0]))
    s.on('close', () => lost('соединение закрыто'))
    s.on('message', (data: unknown) => {
      let m: Record<string, unknown>
      try {
        m = JSON.parse(String(data))
      } catch {
        return
      }
      if (m.type === 'auth_required') return s.send(JSON.stringify({ type: 'auth', access_token: opts.token }))
      if (m.type === 'auth_invalid') return lost('токен отклонён')
      if (m.type === 'auth_ok') return s.send(JSON.stringify({ id: 1, type: 'subscribe_events', event_type: 'state_changed' }))
      if (m.type === 'result' && m.id === 1) {
        if (m.success !== true) return lost('подписка отклонена')
        backoff = BACKOFF_START_MS
        wasUp = true
        return opts.onConnected(true)
      }
      const ev = parseStateChanged(m)
      if (ev) opts.onEvent(ev)
    })
  }
  open()

  return {
    stop() {
      stopped = true
      if (timer) clearTimer(timer)
      timer = null
      if (ws) {
        ws.removeAllListeners()
        ws.on('error', () => undefined)
        try {
          ws.close()
        } catch {
          /* уже закрыт */
        }
        ws = null
      }
      wasUp = false
    },
  }
}
