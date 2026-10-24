// Экранный пульт Marantz RC042SR: кнопки, команды по умолчанию и привязки, которые владелец меняет в режиме «Настроить пульт».
// Привязки общие для всех устройств: настройка панели receiver.remote = { <кнопка>: <команда> | null } (только отличия от умолчаний).
// null — кнопка без команды (серая). Допустимы только команды из белого списка receiver.ts (classify), входы — SI<код>.
import { getSetting, setSetting } from '../settings.js'
import * as receiver from './receiver.js'

export const SETTING_KEY = 'receiver.remote'

/** Кнопки и команды по умолчанию; null — надёжной команды нет (см. README: «Пульт»). */
export const REMOTE_DEFAULTS: Record<string, string | null> = {
  'zone-main': 'ZMTOGGLE',
  'zone-2': 'Z2TOGGLE',
  sleep: 'SLPCYCLE',
  power: 'PWTOGGLE',
  'in-cblsat': 'SISAT/CBL',
  'in-dvd': 'SIDVD',
  'in-bd': 'SIBD',
  'in-game': 'SIGAME',
  'in-aux': 'SIAUX1',
  'in-mplay': 'SIMPLAY',
  'in-tv': 'SITV',
  'in-8k': null, // у NR1604 нет входа 8K
  'in-tuner': 'SITUNER',
  'in-usb': null, // USB/iPod в списке входов NR1604 не задействован
  'in-cd': 'SICD',
  'in-bt': null, // Bluetooth-входа в списке ресивера нет
  'in-heos': null, // HEOS у NR1604 нет
  'in-phono': null, // у NR1604 нет входа Phono
  'in-iradio': 'SIIRADIO',
  'ch-up': 'TPANUP',
  'ch-down': 'TPANDOWN',
  eco: 'ECOCYCLE',
  mute: 'MUTOGGLE',
  'vol-up': 'MVUP',
  'vol-down': 'MVDOWN',
  info: 'MNINF',
  option: 'MNOPT',
  'nav-up': 'MNCUP',
  'nav-down': 'MNCDN',
  'nav-left': 'MNCLT',
  'nav-right': 'MNCRT',
  enter: 'MNENT',
  back: 'MNRTN',
  setup: 'MENUTOGGLE',
  'tune-down': 'TFANDOWN',
  play: null, // команды воспроизведения для сетевых источников (NS9x) по чтению проверить нельзя
  'tune-up': 'TFANUP',
  'ss-1': 'MSQUICK1',
  'ss-2': 'MSQUICK2',
  'ss-3': 'MSQUICK3',
  'ss-4': 'MSQUICK4',
  'sm-movie': 'MSMOVIE',
  'sm-music': 'MSMUSIC',
  'sm-game': 'MSGAME',
  'sm-pure': 'MSPURE DIRECT',
}

export const REMOTE_BUTTONS = Object.keys(REMOTE_DEFAULTS)

// Названия команд для окна выбора (порядок = порядок групп в списке)
const TITLES: [string, string, string][] = [
  ['Питание', 'PWTOGGLE', 'Питание: включить/выключить по состоянию'],
  ['Питание', 'PWON', 'Включить'],
  ['Питание', 'PWSTANDBY', 'Выключить (режим ожидания)'],
  ['Зоны', 'ZMTOGGLE', 'Главная зона: вкл/выкл по состоянию'],
  ['Зоны', 'ZMON', 'Главная зона: включить'],
  ['Зоны', 'ZMOFF', 'Главная зона: выключить'],
  ['Зоны', 'Z2TOGGLE', 'Зона 2: вкл/выкл по состоянию'],
  ['Зоны', 'Z2ON', 'Зона 2: включить'],
  ['Зоны', 'Z2OFF', 'Зона 2: выключить'],
  ['Звук', 'MVUP', 'Громче'],
  ['Звук', 'MVDOWN', 'Тише'],
  ['Звук', 'MUTOGGLE', 'Mute: по состоянию'],
  ['Звук', 'MUON', 'Mute: включить'],
  ['Звук', 'MUOFF', 'Mute: выключить'],
  ['Звук', 'ECOCYCLE', 'ECO: по кругу (вкл → авто → выкл)'],
  ['Звук', 'ECOON', 'ECO: включить'],
  ['Звук', 'ECOAUTO', 'ECO: авто'],
  ['Звук', 'ECOOFF', 'ECO: выключить'],
  ['Таймер сна', 'SLPCYCLE', 'Сон: по кругу (10 → 30 → 60 → 90 → 120 мин → выкл)'],
  ['Таймер сна', 'SLPOFF', 'Сон: выключить'],
  ['Таймер сна', 'SLP010', 'Сон: 10 минут'],
  ['Таймер сна', 'SLP020', 'Сон: 20 минут'],
  ['Таймер сна', 'SLP030', 'Сон: 30 минут'],
  ['Таймер сна', 'SLP060', 'Сон: 60 минут'],
  ['Таймер сна', 'SLP090', 'Сон: 90 минут'],
  ['Таймер сна', 'SLP120', 'Сон: 120 минут'],
  ['Меню', 'MNCUP', 'Меню: вверх'],
  ['Меню', 'MNCDN', 'Меню: вниз'],
  ['Меню', 'MNCLT', 'Меню: влево'],
  ['Меню', 'MNCRT', 'Меню: вправо'],
  ['Меню', 'MNENT', 'Меню: ввод (Enter)'],
  ['Меню', 'MNRTN', 'Меню: назад'],
  ['Меню', 'MENUTOGGLE', 'Меню (Setup): открыть/закрыть'],
  ['Меню', 'MNMEN ON', 'Меню: открыть'],
  ['Меню', 'MNMEN OFF', 'Меню: закрыть'],
  ['Меню', 'MNINF', 'Info'],
  ['Меню', 'MNOPT', 'Option'],
  ['Тюнер', 'TFANUP', 'Тюнер: частота выше (Tune +)'],
  ['Тюнер', 'TFANDOWN', 'Тюнер: частота ниже (Tune −)'],
  ['Тюнер', 'TPANUP', 'Тюнер: следующая станция (Preset +)'],
  ['Тюнер', 'TPANDOWN', 'Тюнер: предыдущая станция (Preset −)'],
  ['Smart Select', 'MSQUICK1', 'Smart/Quick Select 1'],
  ['Smart Select', 'MSQUICK2', 'Smart/Quick Select 2'],
  ['Smart Select', 'MSQUICK3', 'Smart/Quick Select 3'],
  ['Smart Select', 'MSQUICK4', 'Smart/Quick Select 4'],
  ['Smart Select', 'MSSMART1', 'Smart Select 1 (вариант MSSMART)'],
  ['Smart Select', 'MSSMART2', 'Smart Select 2 (вариант MSSMART)'],
  ['Smart Select', 'MSSMART3', 'Smart Select 3 (вариант MSSMART)'],
  ['Smart Select', 'MSSMART4', 'Smart Select 4 (вариант MSSMART)'],
  ['Режим звука', 'MSMOVIE', 'Режим: Movie'],
  ['Режим звука', 'MSMUSIC', 'Режим: Music'],
  ['Режим звука', 'MSGAME', 'Режим: Game'],
  ['Режим звука', 'MSDIRECT', 'Режим: Direct'],
  ['Режим звука', 'MSPURE DIRECT', 'Режим: Pure Direct'],
  ['Режим звука', 'MSSTEREO', 'Режим: Stereo'],
]
const INPUT_TITLES: Record<string, string> = {
  'SAT/CBL': 'CBL/SAT', DVD: 'DVD', BD: 'Blu-ray', GAME: 'Game', AUX1: 'AUX1', AUX2: 'AUX2', MPLAY: 'Media Player', CD: 'CD', TV: 'TV Audio', TUNER: 'Tuner', IRADIO: 'Internet Radio',
}

export type CommandInfo = { command: string; title: string; group: string }
export function commandCatalog(): CommandInfo[] {
  const list: CommandInfo[] = TITLES.map(([group, command, title]) => ({ group, command, title }))
  for (const code of receiver.INPUT_CODES) list.push({ group: 'Входы', command: `SI${code}`, title: `Вход: ${INPUT_TITLES[code] ?? code}` })
  return list
}

export function getOverrides(): Record<string, string | null> {
  const raw = getSetting<Record<string, unknown>>(SETTING_KEY, {})
  const out: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!Object.hasOwn(REMOTE_DEFAULTS, k)) continue
    if (v === null) out[k] = null
    else if (typeof v === 'string') {
      try {
        receiver.classify(v)
        out[k] = v
      } catch {
        /* команда больше не в белом списке — привязка игнорируется */
      }
    }
  }
  return out
}

/** Действующие привязки: умолчание, поверх него сохранённые */
export function getBindings(): Record<string, string | null> {
  return { ...REMOTE_DEFAULTS, ...getOverrides() }
}

/** command: строка из белого списка, null — «без команды», undefined — вернуть значение по умолчанию */
export function setBinding(button: string, command: string | null | undefined) {
  if (!Object.hasOwn(REMOTE_DEFAULTS, button)) throw new receiver.ReceiverError('Такой кнопки нет', 'bad')
  if (typeof command === 'string') receiver.classify(command) // бросит 'bad'
  const cur = getOverrides()
  if (command === undefined || command === REMOTE_DEFAULTS[button]) delete cur[button]
  else cur[button] = command
  setSetting(SETTING_KEY, cur)
}
