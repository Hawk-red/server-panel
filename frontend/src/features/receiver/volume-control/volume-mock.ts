// Мок-данные регулятора громкости (тесты и скриншоты); в рабочем коде не используются.
import type { ReceiverFullState } from '@/lib/receiver-remote'
import { MOCK_STATE } from '../remote-mock'

/** Ресивер включён, громкость −28,0 dB при потолке −20,0 dB */
export const VOLUME_ON: ReceiverFullState = { ...MOCK_STATE, power: 'ON', volume: 52, volumeDb: -28, maxVolume: 60, mute: false }
/** Почти у потолка */
export const VOLUME_HIGH: ReceiverFullState = { ...VOLUME_ON, volume: 59.5, volumeDb: -20.5 }
/** Звук выключен */
export const VOLUME_MUTED: ReceiverFullState = { ...VOLUME_ON, mute: true }
/** Ресивер в режиме ожидания: регулятор серый */
export const VOLUME_OFF: ReceiverFullState = { ...VOLUME_ON, power: 'STANDBY', volume: null, volumeDb: null }
