// Страница «Home Assistant»: разбор статуса и набор ярлыков. Адрес для ссылок даёт общий реестр (/api/links, служба
// homeassistant) — тот же, что у кнопок «Открыть в HA» на карточках «Умного дома»; своей настройки адреса здесь нет.
import type { Status } from '@/components/status-badge'

export type HaPageStatus = {
  configured: boolean
  status: 'ok' | 'pending' | 'no-token' | 'unavailable' | 'unauthorized' | 'error'
  message: string | null
  syncedAt: number | null
  live: boolean
  devices: number
  devicesOnline: number
  scenes: number
  version: string | null
  locationName: string | null
}

/** Состояние связи словом: своё для каждого ответа клиента HA */
export function haStatusView(s: HaPageStatus | undefined, isError = false): { status: Status; label: string; hint: string | null } {
  if (isError) return { status: 'unknown', label: 'нет данных', hint: 'Панель не ответила на запрос состояния' }
  if (!s) return { status: 'unknown', label: 'проверяю…', hint: null }
  switch (s.status) {
    case 'ok':
      return { status: 'ok', label: 'в сети', hint: null }
    case 'pending':
      return { status: 'unknown', label: 'проверяю…', hint: null }
    case 'no-token':
      return { status: 'warning', label: 'токен не задан', hint: 'HA_TOKEN в backend/.env пуст: панель не читает Home Assistant' }
    case 'unauthorized':
      return { status: 'error', label: 'токен не принят', hint: s.message ?? 'Home Assistant отклонил токен: создайте новый токен доступа' }
    case 'unavailable':
      return { status: 'error', label: 'недоступен', hint: s.message ?? 'Home Assistant не отвечает' }
    default:
      return { status: 'error', label: 'ошибка', hint: s.message }
  }
}

export type HaShortcut = { id: string; title: string; subtitle: string; path: string }

// Ярлыки внутрь Home Assistant. Пути — стандартные панели HA; HACS открывается, только если он установлен
export const HA_SHORTCUTS: HaShortcut[] = [
  { id: 'overview', title: 'Обзор', subtitle: 'Lovelace', path: '/' },
  { id: 'devices', title: 'Устройства и службы', subtitle: '/config/devices', path: '/config/devices/dashboard' },
  { id: 'integrations', title: 'Интеграции', subtitle: '/config/integrations', path: '/config/integrations/dashboard' },
  { id: 'automations', title: 'Автоматизации', subtitle: '/config/automation', path: '/config/automation/dashboard' },
  { id: 'hacs', title: 'HACS', subtitle: 'если установлен', path: '/hacs' },
]
