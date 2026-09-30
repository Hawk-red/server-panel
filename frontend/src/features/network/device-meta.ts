import { CircleHelp, Cpu, Router, Smartphone, Speaker, Tv } from 'lucide-react'
import type { Device, DeviceType } from '@/lib/types'

// «Телефон / планшет» — один тип; «Другое» — всё остальное (ноутбуки, принтеры, компьютеры, серверы и нераспознанное)
export const TYPES: Record<DeviceType, { label: string; icon: React.ElementType }> = {
  router: { label: 'Роутер / сеть', icon: Router },
  phone: { label: 'Телефон / планшет', icon: Smartphone },
  tv: { label: 'ТВ', icon: Tv },
  media: { label: 'Медиа', icon: Speaker },
  iot: { label: 'Умный дом', icon: Cpu },
  unknown: { label: 'Другое', icon: CircleHelp },
}

// Группы для фильтра
export const TYPE_GROUPS: { id: string; label: string; types: DeviceType[] }[] = [
  { id: 'phone', label: 'Телефоны и планшеты', types: ['phone'] },
  { id: 'tv', label: 'ТВ', types: ['tv'] },
  { id: 'media', label: 'Медиа', types: ['media'] },
  { id: 'iot', label: 'Умный дом', types: ['iot'] },
  { id: 'net', label: 'Роутер / сеть', types: ['router'] },
  { id: 'other', label: 'Другое', types: ['unknown'] },
]

export const displayName = (d: Device) => d.name ?? d.hostname ?? d.vendor ?? 'Без названия'

export function webHref(d: Device, p: Device['ports'][number]) {
  const https = p.port === 443 || p.port === 8443 || p.service === 'https'
  return `${https ? 'https' : 'http'}://${d.ip}:${p.port}/`
}
