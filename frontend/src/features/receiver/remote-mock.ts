// Мок-данные для проверки раскладки пульта (тесты и скриншоты); в рабочем коде страницы не используются.
import type { RemoteConfig } from '@/lib/receiver-pad'
import type { ReceiverFullState } from '@/lib/receiver-remote'

export const MOCK_STATE: ReceiverFullState = {
  power: 'ON', volume: 42, volumeDb: -38, maxVolume: 60, mute: false,
  input: { code: 'BD', name: 'ANDROID' },
  inputs: [
    { code: 'SAT/CBL', name: 'IPAD' }, { code: 'DVD', name: 'DVD' }, { code: 'BD', name: 'ANDROID' }, { code: 'GAME', name: 'GAME' },
    { code: 'AUX1', name: 'FRONT' }, { code: 'MPLAY', name: 'MacMini' }, { code: 'TV', name: 'PS4 & TV' }, { code: 'TUNER', name: 'TUNER' }, { code: 'IRADIO', name: 'Internet Radio' },
  ],
  mode: 'STEREO', dynEq: 'ON', dynVol: 'OFF', refLev: '0', tone: 'OFF', multEq: 'AUDYSSEY',
}

const defaults: Record<string, string | null> = {
  'zone-main': 'ZMTOGGLE', 'zone-2': 'Z2TOGGLE', sleep: 'SLPCYCLE', power: 'PWTOGGLE',
  'in-cblsat': 'SISAT/CBL', 'in-dvd': 'SIDVD', 'in-bd': 'SIBD', 'in-game': 'SIGAME', 'in-aux': 'SIAUX1', 'in-mplay': 'SIMPLAY', 'in-tv': 'SITV', 'in-8k': null, 'in-tuner': 'SITUNER',
  'in-usb': null, 'in-cd': 'SICD', 'in-bt': null, 'in-heos': null, 'in-phono': null, 'in-iradio': 'SIIRADIO',
  'ch-up': 'TPANUP', 'ch-down': 'TPANDOWN', eco: 'ECOCYCLE', mute: 'MUTOGGLE', 'vol-up': 'MVUP', 'vol-down': 'MVDOWN',
  info: 'MNINF', option: 'MNOPT', 'nav-up': 'MNCUP', 'nav-down': 'MNCDN', 'nav-left': 'MNCLT', 'nav-right': 'MNCRT', enter: 'MNENT', back: 'MNRTN', setup: 'MENUTOGGLE',
  'tune-down': 'TFANDOWN', play: null, 'tune-up': 'TFANUP', 'ss-1': 'MSQUICK1', 'ss-2': 'MSQUICK2', 'ss-3': 'MSQUICK3', 'ss-4': 'MSQUICK4',
  'sm-movie': 'MSMOVIE', 'sm-music': 'MSMUSIC', 'sm-game': 'MSGAME', 'sm-pure': 'MSPURE DIRECT',
}

export const MOCK_CFG: RemoteConfig = {
  defaults,
  bindings: { ...defaults },
  commands: [
    { group: 'Питание', command: 'PWTOGGLE', title: 'Питание: включить/выключить по состоянию' },
    { group: 'Звук', command: 'MVUP', title: 'Громче' },
    { group: 'Звук', command: 'ECOCYCLE', title: 'ECO: по кругу (вкл → авто → выкл)' },
    { group: 'Меню', command: 'MNENT', title: 'Меню: ввод (Enter)' },
    { group: 'Входы', command: 'SIBD', title: 'Вход: Blu-ray' },
  ],
}
