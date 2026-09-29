import { Cpu, LayoutDashboard, Network, Wifi, Download, type LucideIcon } from 'lucide-react'

// Разделы ТВ-режима. Порядок — порядок слайд-шоу; остальные разделы панели добавляются сюда же.
export const TV_SECTIONS = [
  { id: 'overview', title: 'Обзор', icon: LayoutDashboard, color: 'text-brand' },
  { id: 'system', title: 'Система', icon: Cpu, color: 'text-info' },
  { id: 'internet', title: 'Интернет', icon: Wifi, color: 'text-info' },
  { id: 'torrents', title: 'Торренты', icon: Download, color: 'text-ok' },
  { id: 'network', title: 'Сеть', icon: Network, color: 'text-indigo' },
] as const satisfies readonly { id: string; title: string; icon: LucideIcon; color: string }[]

export type TvSectionId = (typeof TV_SECTIONS)[number]['id']
export const isTvSection = (s: string): s is TvSectionId => TV_SECTIONS.some((x) => x.id === s)
