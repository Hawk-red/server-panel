// Мок-данные для проверки раскладки пульта ТВ и карточки «Телевизор» (тесты и скриншоты).
import type { RemoteConfig } from '@/lib/receiver-pad'
import type { TvStatus } from '@/lib/tv-pad'

export const TV_ONLINE: TvStatus = { online: true, port: 8002, paired: true, host: '192.168.31.181', sceneOn: 'scene.tv_on' }
export const TV_OFFLINE: TvStatus = { ...TV_ONLINE, online: false, port: null }

const defaults: Record<string, string | null> = {
  power: 'KEY_POWER', source: 'KEY_SOURCE', ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`num-${i}`, `KEY_${i}`])),
  ttx: 'KEY_TTX_MIX', prech: 'KEY_PRECH', 'vol-up': 'KEY_VOLUP', 'vol-down': 'KEY_VOLDOWN', mute: 'KEY_MUTE', 'ch-list': 'KEY_CH_LIST', 'p-up': 'KEY_CHUP', 'p-down': 'KEY_CHDOWN',
  content: 'KEY_CONTENTS', menu: 'KEY_MENU', guide: 'KEY_GUIDE', tools: 'KEY_TOOLS', info: 'KEY_INFO',
  'nav-up': 'KEY_UP', 'nav-down': 'KEY_DOWN', 'nav-left': 'KEY_LEFT', 'nav-right': 'KEY_RIGHT', enter: 'KEY_ENTER', return: 'KEY_RETURN', exit: 'KEY_EXIT',
  'color-a': 'KEY_RED', 'color-b': 'KEY_GREEN', 'color-c': 'KEY_YELLOW', 'color-d': 'KEY_CYAN',
  emanual: 'KEY_EMANUAL', psize: 'KEY_PICTURE_SIZE', ad: 'KEY_AD', stop: 'KEY_STOP', rew: 'KEY_REWIND', play: 'KEY_PLAY', pause: 'KEY_PAUSE', ff: 'KEY_FF',
}
export const TV_CFG: RemoteConfig = {
  defaults,
  bindings: { ...defaults },
  commands: [
    { group: 'Ключи ТВ', command: 'KEY_POWER', title: 'Питание' },
    { group: 'Ключи ТВ', command: 'KEY_MENU', title: 'Меню' },
    { group: 'Ключи ТВ', command: 'KEY_AD', title: 'Аудиоописание / субтитры (AD/SUBT.) — не проверено' },
  ],
}
