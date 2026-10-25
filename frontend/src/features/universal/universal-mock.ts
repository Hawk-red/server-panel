// Мок-данные универсального пульта: два столбца, как их отдаёт сервер (для тестов и скриншотов).
import type { ReceiverFullState } from '@/lib/receiver-remote'
import type { UniButton, UniButtonView, UniData } from '@/lib/universal-pad'

const RESOLVED: Record<string, string> = {
  'tv-power': 'KEY_POWER', 'tv-source': 'KEY_SOURCE', 'tv-vol-up': 'KEY_VOLUP', 'tv-vol-down': 'KEY_VOLDOWN', 'tv-mute': 'KEY_MUTE',
  'tv-ch-up': 'KEY_CHUP', 'tv-ch-down': 'KEY_CHDOWN', 'tv-up': 'KEY_UP', 'tv-left': 'KEY_LEFT', 'tv-enter': 'KEY_ENTER', 'tv-right': 'KEY_RIGHT',
  'tv-down': 'KEY_DOWN', 'tv-return': 'KEY_RETURN', 'tv-exit': 'KEY_EXIT', 'tv-menu': 'KEY_MENU', 'tv-info': 'KEY_INFO', 'tv-play': 'KEY_PLAY', 'tv-pause': 'KEY_PAUSE',
  'av-power': 'PWTOGGLE', 'av-vol-up': 'MVUP', 'av-vol-down': 'MVDOWN', 'av-mute': 'MUTOGGLE',
  'av-in-tv': 'SITV', 'av-in-satcbl': 'SISAT/CBL', 'av-in-mplay': 'SIMPLAY',
  'av-sm-movie': 'MSMOVIE', 'av-sm-music': 'MSMUSIC', 'av-sm-game': 'MSGAME', 'av-sm-pure': 'MSPURE DIRECT',
  'av-ss-1': 'MSQUICK1', 'av-ss-2': 'MSQUICK2', 'av-ss-3': 'MSQUICK3', 'av-ss-4': 'MSQUICK4',
  'uni-1': 'scene.tv_on',
}

const b = (id: string, source: UniButtonView['source'], command: string, label: string, icon: UniButtonView['icon'], color: UniButtonView['color']): UniButtonView => ({
  id, source, command, label, icon, color, resolved: RESOLVED[id] ?? null, title: label, available: Boolean(RESOLVED[id]),
})

/** Левый столбец: телевизор Samsung и сцена */
export const UNI_TV: UniButtonView[] = [
  b('tv-power', 'tv', 'power', 'Телевизор', 'power', 'red'),
  b('tv-source', 'tv', 'source', 'Источник', 'tv', 'cyan'),
  b('tv-vol-up', 'tv', 'vol-up', 'Громче', 'volume', 'green'),
  b('tv-vol-down', 'tv', 'vol-down', 'Тише', 'volume', 'green'),
  b('tv-mute', 'tv', 'mute', 'Без звука', 'volume', 'slate'),
  b('tv-ch-up', 'tv', 'p-up', 'Канал +', 'monitor', 'blue'),
  b('tv-ch-down', 'tv', 'p-down', 'Канал −', 'monitor', 'blue'),
  b('tv-up', 'tv', 'nav-up', '▲', 'monitor', 'slate'),
  b('tv-left', 'tv', 'nav-left', '◀', 'monitor', 'slate'),
  b('tv-enter', 'tv', 'enter', 'OK', 'monitor', 'blue'),
  b('tv-right', 'tv', 'nav-right', '▶', 'monitor', 'slate'),
  b('tv-down', 'tv', 'nav-down', '▼', 'monitor', 'slate'),
  b('tv-return', 'tv', 'return', 'Назад', 'monitor', 'slate'),
  b('tv-exit', 'tv', 'exit', 'Выход', 'monitor', 'slate'),
  b('tv-menu', 'tv', 'menu', 'Меню', 'tv', 'slate'),
  b('tv-info', 'tv', 'info', 'Инфо', 'tv', 'slate'),
  b('tv-play', 'tv', 'play', 'Play', 'monitor', 'emerald'),
  b('tv-pause', 'tv', 'pause', 'Pause', 'monitor', 'orange'),
  b('uni-1', 'scene', 'scene.tv_on', 'TV ON', 'sparkles', 'green'),
]

/** Правый столбец: ресивер Marantz, входы — из живого списка */
export const UNI_RECEIVER: UniButtonView[] = [
  b('av-power', 'receiver', 'power', 'Ресивер', 'power', 'orange'),
  b('av-vol-up', 'receiver', 'vol-up', 'Громче', 'volume', 'green'),
  b('av-vol-down', 'receiver', 'vol-down', 'Тише', 'volume', 'green'),
  b('av-mute', 'receiver', 'mute', 'Без звука', 'volume', 'slate'),
  b('av-in-tv', 'receiver', 'in-tv', 'PS4 & TV', 'gamepad', 'cyan'),
  b('av-in-satcbl', 'receiver', 'in-cblsat', 'ANDROID', 'monitor', 'cyan'),
  b('av-in-mplay', 'receiver', 'in-mplay', 'MacMini', 'laptop', 'cyan'),
  b('av-sm-movie', 'receiver', 'sm-movie', 'Movie', 'clapperboard', 'blue'),
  b('av-sm-music', 'receiver', 'sm-music', 'Music', 'radio', 'violet'),
  b('av-sm-game', 'receiver', 'sm-game', 'Game', 'gamepad', 'orange'),
  b('av-sm-pure', 'receiver', 'sm-pure', 'Pure Direct', 'sparkles', 'emerald'),
  b('av-ss-1', 'receiver', 'ss-1', 'Быстрый 1', 'sparkles', 'cyan'),
  b('av-ss-2', 'receiver', 'ss-2', 'Быстрый 2', 'sparkles', 'cyan'),
  b('av-ss-3', 'receiver', 'ss-3', 'Быстрый 3', 'sparkles', 'cyan'),
  b('av-ss-4', 'receiver', 'ss-4', 'Быстрый 4', 'sparkles', 'cyan'),
]

const strip = (list: UniButtonView[]): UniButton[] => list.map(({ id, source, command, label, icon, color }) => ({ id, source, command, label, icon, color }))

export const UNI_DATA: UniData = {
  columns: {
    tv: { buttons: UNI_TV, defaults: strip(UNI_TV.slice(0, 18)), isDefault: false },
    receiver: { buttons: UNI_RECEIVER, defaults: strip(UNI_RECEIVER), isDefault: true },
  },
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
