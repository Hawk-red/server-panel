// Логика пульта ресивера Marantz без React: подписи, значки, «удержание» с повтором, оптимистичное обновление.
export type ReceiverInput = { code: string; name: string }
export type ReceiverFullState = {
  power: 'ON' | 'STANDBY' | null
  volume: number | null // шкала ресивера MV; dB = volume − 80
  volumeDb: number | null
  maxVolume: number
  mute: boolean | null
  input: { code: string | null; name: string | null } | null
  inputs: ReceiverInput[]
  mode: string | null
  dynEq: string | null
  dynVol: string | null
  refLev: string | null
  tone: string | null
  multEq: string | null
}
export type CmdResult = { command: string; cls: string; accepted: boolean; message: string | null; volume: number | null; state: ReceiverFullState | null }

/** Громкость (шкала ресивера) → «−40,0 dB» */
export function formatDb(volume: number | null): string {
  if (volume === null) return '— dB'
  const db = volume - 80
  const s = Math.abs(db).toFixed(1).replace('.', ',')
  return `${db < 0 ? '−' : db > 0 ? '+' : ''}${s} dB`
}

/** Положение на полосе уровня, 0..1 (шкала 0 dB = MV80) */
export const levelFraction = (volume: number | null) => (volume === null ? 0 : Math.max(0, Math.min(1, volume / 80)))

/** Значок входа по имени (имена переименованных входов, например «PS4 & TV», «ANDROID», «MacMini») */
export function inputIcon(name: string): string {
  const n = name.toLowerCase()
  if (/apple/.test(n)) return '🍎'
  if (/game|ps\d|xbox|nintendo/.test(n)) return '🎮'
  if (/tv/.test(n)) return '📺'
  if (/bd|blu|dvd|\bcd\b/.test(n)) return '💿'
  if (/android|ipad|iphone|phone/.test(n)) return '📱'
  if (/mac|pc|media|player|mini/.test(n)) return '💻'
  if (/radio|tuner/.test(n)) return '📻'
  if (/cbl|sat/.test(n)) return '📡'
  return '🔌'
}

/** Активный вход: по имени от ресивера (надёжнее), иначе по коду */
export function activeInput(state: ReceiverFullState | undefined, inputs: ReceiverInput[]): string | null {
  if (!state?.input) return null
  const norm = (s: string) => s.trim().toLowerCase()
  const byName = state.input.name ? inputs.find((i) => norm(i.name) === norm(state.input!.name!)) : undefined
  return (byName ?? inputs.find((i) => i.code === state.input!.code))?.code ?? null
}

/** Режим, который подсвечивать: точное совпадение с кнопкой, иначе последний нажатый, пока режим не сменился */
export function activeMode(mode: string | null, last: { cmd: string; modeAtClick: string | null } | null): string | null {
  const exact: Record<string, string> = { STEREO: 'MSSTEREO', DIRECT: 'MSDIRECT', MOVIE: 'MSMOVIE', MUSIC: 'MSMUSIC', GAME: 'MSGAME' }
  if (mode && exact[mode]) return exact[mode]
  if (last && last.modeAtClick === mode) return last.cmd
  return null
}

/** Оптимистичное изменение громкости на шаг команды MVUP/MVDOWN (±0,5), не выше потолка при росте */
export function bumpVolume(state: ReceiverFullState, command: 'MVUP' | 'MVDOWN'): ReceiverFullState {
  if (state.volume === null) return state
  const v = command === 'MVUP' ? Math.min(state.volume + 0.5, state.maxVolume) : Math.max(state.volume - 0.5, 0)
  return { ...state, volume: v, volumeDb: v - 80 }
}

// «Удержание»: сразу одна команда, затем повтор каждые HOLD_INTERVAL_MS; суммарно не чаще 4 команд в секунду (как на сервере)
export const HOLD_INTERVAL_MS = 280
type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void }
const realTimers: Timers = { set: (fn, ms) => setInterval(fn, ms), clear: (id) => clearInterval(id as ReturnType<typeof setInterval>) }
export function createHold(fire: () => void, timers: Timers = realTimers) {
  let id: unknown = null
  return {
    start() {
      if (id !== null) return
      fire()
      id = timers.set(fire, HOLD_INTERVAL_MS)
    },
    stop() {
      if (id !== null) timers.clear(id)
      id = null
    },
    get active() {
      return id !== null
    },
  }
}
