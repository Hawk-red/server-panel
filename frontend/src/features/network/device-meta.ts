import { CircleHelp, Cpu, Laptop, Monitor, Printer, Radio, Router, Server, Smartphone, Speaker, Tablet, Tv } from 'lucide-react'
import type { Device, DeviceType } from '@/lib/types'

export const TYPES: Record<DeviceType, { label: string; icon: React.ElementType }> = {
  router: { label: 'Роутер / сеть', icon: Router },
  server: { label: 'Сервер', icon: Server },
  desktop: { label: 'Компьютер', icon: Monitor },
  laptop: { label: 'Ноутбук', icon: Laptop },
  phone: { label: 'Телефон', icon: Smartphone },
  tablet: { label: 'Планшет', icon: Tablet },
  tv: { label: 'ТВ / приставка', icon: Tv },
  receiver: { label: 'Аудио / ресивер', icon: Speaker },
  ir: { label: 'ИК-передатчик', icon: Radio },
  iot: { label: 'Умный дом / IoT', icon: Cpu },
  printer: { label: 'Принтер', icon: Printer },
  unknown: { label: 'Неизвестно', icon: CircleHelp },
}

// Группы для фильтра (ТЗ 9.8)
export const TYPE_GROUPS: { id: string; label: string; types: DeviceType[] }[] = [
  { id: 'laptop', label: 'Ноутбуки', types: ['laptop'] },
  { id: 'mobile', label: 'Телефоны и планшеты', types: ['phone', 'tablet'] },
  { id: 'tv', label: 'ТВ и приставки', types: ['tv'] },
  { id: 'server', label: 'Серверы', types: ['server'] },
  { id: 'audio', label: 'Аудио', types: ['receiver'] },
  { id: 'iot', label: 'Умный дом / IoT', types: ['iot', 'ir'] },
  { id: 'net', label: 'Сеть', types: ['router'] },
  // тип «Компьютер» в сети не встречается — отдельной кнопки фильтра нет; на всякий случай такие устройства попадают в «Другое»
  { id: 'other', label: 'Другое', types: ['printer', 'unknown', 'desktop'] },
]

export const displayName = (d: Device) => d.name ?? d.hostname ?? d.vendor ?? 'Без названия'

export function webHref(d: Device, p: Device['ports'][number]) {
  const https = p.port === 443 || p.port === 8443 || p.service === 'https'
  return `${https ? 'https' : 'http'}://${d.ip}:${p.port}/`
}
