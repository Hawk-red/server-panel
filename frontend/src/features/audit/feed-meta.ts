import type { FeedRow } from '@/lib/types'

// Человеческие названия действий панели и системных событий
export const KIND_LABELS: Record<string, string> = {
  'auth.login': 'Вход в панель',
  'auth.logout': 'Выход из панели',
  'service.start': 'Запуск службы',
  'service.stop': 'Остановка службы',
  'service.restart': 'Перезапуск службы',
  'container.start': 'Запуск контейнера',
  'container.stop': 'Остановка контейнера',
  'container.restart': 'Перезапуск контейнера',
  'torrents.stop-all': 'Пауза всех торрентов',
  'torrents.start-all': 'Продолжить все торренты',
  'adguard.protection-off': 'AdGuard: защита выключена',
  'adguard.protection-on': 'AdGuard: защита включена',
  'disks.smart-refresh': 'Обновление SMART',
  'ssh-key.disable': 'Отключение SSH-ключа',
  'ssh-key.enable': 'Возврат SSH-ключа',
  'ufw.deny': 'Блокировка IP (ufw)',
  'ufw.undeny': 'Разблокировка IP (ufw)',
  'fail2ban.ban': 'Бан в fail2ban',
  'fail2ban.unban': 'Разбан в fail2ban',
  'session.kill': 'Завершение сессии',
  'ssh.stop': 'Отключение SSH',
  'ssh.start': 'Включение SSH',
  'network.discover': 'Сканирование сети',
  'network.port-scan': 'Сканирование портов',
  'network.device-update': 'Изменение устройства',
  'network.device-delete': 'Удаление устройства',
  'settings.portainer': 'Настройка Portainer',
  'settings.notify': 'Настройка уведомлений',
  'notify.test': 'Тестовое уведомление',
  // системные события
  'unit.failed': 'Служба упала',
  'unit.recovered': 'Служба поднялась',
  'disk.threshold': 'Диск: порог заполнения',
  'disk.missing': 'Диск отвалился',
  'disk.back': 'Диск вернулся',
  'device.new': 'Новое устройство в сети',
  'f2b.ban': 'fail2ban забанил IP',
  'container.stopped': 'Контейнер остановился',
  'container.started': 'Контейнер запустился',
  'sync.ok': 'Синк jetsetter: успешно',
  'sync.error': 'Синк jetsetter: с ошибками',
}
export const kindLabel = (k: string) => KIND_LABELS[k] ?? k

// Куда вести по записи
export function feedLink(r: FeedRow): { to: string; search?: Record<string, string>; label: string } | null {
  const k = r.kind
  const t = r.target ?? ''
  if ((k.startsWith('network.') || k === 'device.new') && /^[0-9a-f:]{17}$/.test(t)) return { to: '/network', search: { device: t }, label: 'Устройство в «Сети»' }
  if (k.startsWith('network.')) return { to: '/network', label: 'Сеть и устройства' }
  if (k.startsWith('disk')) return { to: '/system', search: { tab: 'disks' }, label: 'Система → Диски' }
  if ((k.startsWith('service.') || k.startsWith('unit.')) && t) return { to: '/system', search: { tab: 'logs', source: `journal:${t}` }, label: 'Лог службы' }
  if (k.startsWith('container.') && t) return { to: '/system', search: { tab: 'logs', source: `container:${t}` }, label: 'Лог контейнера' }
  if (/^(auth|ssh|ssh-key|session|ufw|fail2ban|f2b)\./.test(k)) return { to: '/access', label: 'SSH и доступ' }
  if (k.startsWith('torrents.')) return { to: '/torrents', label: 'Торренты' }
  if (k.startsWith('adguard.')) return { to: '/adguard', label: 'AdGuard Home' }
  if (k.startsWith('settings.portainer')) return { to: '/docker', label: 'Docker' }
  if (k.startsWith('sync.')) return { to: '/sites', label: 'Сайты и API' }
  return null
}

export const LEVEL: Record<FeedRow['level'], { status: 'ok' | 'error' | 'warning' | 'unknown'; text: string }> = {
  ok: { status: 'ok', text: 'успешно' },
  error: { status: 'error', text: 'ошибка' },
  denied: { status: 'warning', text: 'отказано' },
  info: { status: 'unknown', text: 'инфо' },
  warning: { status: 'warning', text: 'внимание' },
}

export function describeDetails(d: unknown): string {
  if (!d || typeof d !== 'object') return ''
  const o = d as Record<string, unknown>
  if (o.reason === 'bad-password') return 'неверный пароль'
  if (o.reason === 'rate-limit') return 'превышен лимит попыток'
  return Object.entries(o)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(', ')
}
