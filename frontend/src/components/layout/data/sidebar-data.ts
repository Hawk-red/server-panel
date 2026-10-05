import {
  Bluetooth,
  BellRing,
  Bot,
  Container,
  HardDrive,
  PackageCheck,
  Cpu,
  DatabaseBackup,
  Download,
  Globe,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  Music,
  Network,
  Wifi,
  ScrollText,
  ShieldCheck,
  ShieldHalf,
  Sparkles,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  navGroups: [
    {
      title: 'Главное',
      items: [
        { title: 'Обзор', url: '/', icon: LayoutDashboard, color: 'text-brand' },
        { title: 'Система', url: '/system', icon: Cpu, color: 'text-info' },
        { title: 'Диски', url: '/disks', icon: HardDrive, color: 'text-volume' },
        { title: 'Обновления', url: '/updates', icon: PackageCheck, color: 'text-ok' },
        { title: 'Бэкапы', url: '/backups', icon: DatabaseBackup, color: 'text-volume' },
        { title: 'Git', url: '/git', icon: GitBranch, color: 'text-indigo' },
        { title: 'Уведомления', url: '/notifications', icon: BellRing, color: 'text-brand' },
      ],
    },
    {
      title: 'Сервисы',
      items: [
        { title: 'Медиа', url: '/media', icon: Music, color: 'text-volume' },
        { title: 'Торренты', url: '/torrents', icon: Download, color: 'text-ok' },
        { title: 'AdGuard Home', url: '/adguard', icon: ShieldCheck, color: 'text-ok' },
        { title: 'Docker', url: '/docker', icon: Container, color: 'text-info' },
        { title: 'Локальный AI', url: '/ai', icon: Sparkles, color: 'text-brand' },
        { title: 'Сайты и API', url: '/sites', icon: Globe, color: 'text-indigo' },
        { title: 'Telegram-боты', url: '/telegram', icon: Bot, color: 'text-volume' },
      ],
    },
    {
      title: 'Доступ и сеть',
      items: [
        { title: 'Интернет', url: '/internet', icon: Wifi, color: 'text-info' },
        { title: 'Беспроводные', url: '/wireless', icon: Bluetooth, color: 'text-info' },
        { title: 'SSH и доступ', url: '/access', icon: KeyRound, color: 'text-brand' },
        { title: 'Безопасность', url: '/security', icon: ShieldHalf, color: 'text-ok' },
        { title: 'Сеть и устройства', url: '/network', icon: Network, color: 'text-indigo' },
        { title: 'Журнал действий', url: '/audit', icon: ScrollText, color: 'text-muted-foreground' },
      ],
    },
  ],
}
