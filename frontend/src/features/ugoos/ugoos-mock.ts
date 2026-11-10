// Мок-данные для проверки раскладки пульта UGOOS (тесты и скриншоты).
import type { RemoteConfig } from '@/lib/receiver-pad'
import type { UgoosStatus } from '@/lib/ugoos-pad'

const KEYS_ALL = ['POWER', 'HOME', 'BACK', 'MENU', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'DPAD_CENTER', 'VOL_UP', 'VOL_DOWN', 'MUTE']
/** Бокс на связи по ADB: работают все кнопки */
export const UGOOS_ONLINE: UgoosStatus = { online: true, keys: KEYS_ALL }
/** Частичный список «доступных» ключей от бэкенда — кнопки с привязкой всё равно активны (ugoosKeyStatus его игнорирует) */
export const UGOOS_PARTIAL_KEYS: UgoosStatus = { ...UGOOS_ONLINE, keys: ['VOL_UP', 'VOL_DOWN', 'MUTE', 'POWER'] }
export const UGOOS_OFFLINE: UgoosStatus = { ...UGOOS_ONLINE, online: false }

const defaults: Record<string, string | null> = {
  power: 'POWER',
  mute: 'MUTE',
  'dpad-up': 'DPAD_UP',
  'dpad-down': 'DPAD_DOWN',
  'dpad-left': 'DPAD_LEFT',
  'dpad-right': 'DPAD_RIGHT',
  ok: 'DPAD_CENTER',
  back: 'BACK',
  home: 'HOME',
  menu: 'MENU',
  'vol-up': 'VOL_UP',
  'vol-down': 'VOL_DOWN',
  power2: null,
  cursor: null,
  settings: null,
  mic: null,
  'arrow-up2': null,
  'arrow-down2': null,
  'app-1': null,
  'app-2': null,
  'app-3': null,
  'app-4': null,
  'app-5': null,
  'app-6': null,
}
export const UGOOS_CFG: RemoteConfig = {
  defaults,
  bindings: { ...defaults },
  commands: [
    { group: 'Ключи UGOOS', command: 'POWER', title: 'Питание' },
    { group: 'Ключи UGOOS', command: 'HOME', title: 'Домой' },
    { group: 'Ключи UGOOS', command: 'MENU', title: 'Меню' },
  ],
}
