// Мок-данные универсального пульта: начальный набор, как его отдаёт сервер (для тестов и скриншотов).
import type { ReceiverFullState } from '@/lib/receiver-remote'
import type { UniButtonView, UniData } from '@/lib/universal-pad'

const RESOLVED: Record<string, string> = {
  'tv-power': 'KEY_POWER', 'av-power': 'PWTOGGLE', 'av-vol-up': 'MVUP', 'av-vol-down': 'MVDOWN', 'av-mute': 'MUTOGGLE', 'tv-menu': 'KEY_MENU',
  'tv-up': 'KEY_UP', 'tv-left': 'KEY_LEFT', 'tv-enter': 'KEY_ENTER', 'tv-right': 'KEY_RIGHT', 'tv-down': 'KEY_DOWN', 'tv-return': 'KEY_RETURN', 'tv-exit': 'KEY_EXIT',
  'av-in-tv': 'SITV', 'av-in-cblsat': 'SISAT/CBL', 'av-in-mplay': 'SIMPLAY', 'av-sm-movie': 'MSMOVIE', 'av-sm-music': 'MSMUSIC', 'av-sm-game': 'MSGAME', 'av-sm-pure': 'MSPURE DIRECT',
}

const b = (id: string, source: UniButtonView['source'], command: string, label: string, icon: UniButtonView['icon'], color: UniButtonView['color']): UniButtonView => ({
  id, source, command, label, icon, color, resolved: RESOLVED[id] ?? null, title: label, available: Boolean(RESOLVED[id]),
})

export const UNI_BUTTONS: UniButtonView[] = [
  b('tv-power', 'tv', 'power', 'Телевизор', 'power', 'red'),
  b('av-power', 'receiver', 'power', 'Ресивер', 'power', 'orange'),
  b('av-vol-up', 'receiver', 'vol-up', 'Громче', 'volume', 'green'),
  b('av-vol-down', 'receiver', 'vol-down', 'Тише', 'volume', 'green'),
  b('av-mute', 'receiver', 'mute', 'Без звука', 'volume', 'slate'),
  b('tv-menu', 'tv', 'menu', 'Меню ТВ', 'tv', 'slate'),
  b('tv-up', 'tv', 'nav-up', '▲', 'monitor', 'slate'),
  b('tv-left', 'tv', 'nav-left', '◀', 'monitor', 'slate'),
  b('tv-enter', 'tv', 'enter', 'OK', 'monitor', 'blue'),
  b('tv-right', 'tv', 'nav-right', '▶', 'monitor', 'slate'),
  b('tv-down', 'tv', 'nav-down', '▼', 'monitor', 'slate'),
  b('tv-return', 'tv', 'return', 'Назад', 'monitor', 'slate'),
  b('tv-exit', 'tv', 'exit', 'Выход', 'monitor', 'slate'),
  b('av-in-tv', 'receiver', 'in-tv', 'Вход TV', 'tv', 'cyan'),
  b('av-in-cblsat', 'receiver', 'in-cblsat', 'Вход CBL/SAT', 'monitor', 'cyan'),
  b('av-in-mplay', 'receiver', 'in-mplay', 'Вход Media Player', 'laptop', 'cyan'),
  b('av-sm-movie', 'receiver', 'sm-movie', 'Movie', 'clapperboard', 'blue'),
  b('av-sm-music', 'receiver', 'sm-music', 'Music', 'radio', 'violet'),
  b('av-sm-game', 'receiver', 'sm-game', 'Game', 'gamepad', 'orange'),
  b('av-sm-pure', 'receiver', 'sm-pure', 'Pure Direct', 'sparkles', 'emerald'),
  { id: 'uni-1', source: 'scene', command: 'scene.tv_on', label: 'TV ON', icon: 'tv', color: 'green', resolved: 'scene.tv_on', title: 'TV ON', available: true },
]

export const UNI_DATA: UniData = {
  buttons: UNI_BUTTONS,
  defaults: UNI_BUTTONS.slice(0, 20).map(({ id, source, command, label, icon, color }) => ({ id, source, command, label, icon, color })),
  isDefault: false,
  max: 48,
  catalog: {
    receiver: [{ command: 'vol-up', title: 'Громче', group: 'Пульт ресивера' }, { command: 'mute', title: 'Выключить звук', group: 'Пульт ресивера' }],
    tv: [{ command: 'nav-up', title: 'Вверх', group: 'Пульт ТВ' }, { command: 'num-1', title: 'Цифра 1', group: 'Пульт ТВ' }],
    scenes: [{ command: 'scene.tv_on', title: 'TV ON', color: 'green', icon: 'tv', available: true }],
  },
}

/** Ресивер включён, в списке входов только TV и Media Player (CBL/SAT нет — плитка серая) */
export const RECEIVER_ON = { power: 'ON', inputs: [{ code: 'TV', name: 'TV' }, { code: 'MPLAY', name: 'Media Player' }] } as unknown as ReceiverFullState
export const TV_ON = { online: true, paired: true, driver: 'ha' as const, keys: Object.values(RESOLVED).filter((c) => c.startsWith('KEY_')) }
