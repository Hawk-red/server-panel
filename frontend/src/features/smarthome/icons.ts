import { AirVent, AlertCircle, Box, Camera, Cloud, Folder, House, Lightbulb, Lock, Plug, Router, Speaker, Thermometer, Tv } from 'lucide-react'
import { AxiosError } from 'axios'
import type { Accent, GroupIcon, IconId } from '@/lib/smarthome'

export const ICON_COMPONENT: Record<IconId, typeof Box> = {
  lamp: Lightbulb, socket: Plug, sensor: Thermometer, camera: Camera, lock: Lock, ac: AirVent, tv: Tv, router: Router, speaker: Speaker, other: Box,
}
export const GROUP_ICON: Record<GroupIcon, typeof Box> = { home: House, plug: Plug, cloud: Cloud, folder: Folder, box: Box }
export const WARN_ICON = AlertCircle

// Цвета-акценты блоков (классы заданы целиком, чтобы Tailwind их не вырезал)
export const ACCENT_TEXT: Record<Accent, string> = { info: 'text-info', ok: 'text-ok', warn: 'text-warn', brand: 'text-brand', indigo: 'text-indigo', volume: 'text-volume' }
export const ACCENT_BAR: Record<Accent, string> = { info: 'border-l-info', ok: 'border-l-ok', warn: 'border-l-warn', brand: 'border-l-brand', indigo: 'border-l-indigo', volume: 'border-l-volume' }

export type ApiError = { message?: string; field?: string }
export const apiError = (e: unknown): ApiError => (e instanceof AxiosError ? ((e.response?.data as ApiError | undefined) ?? { message: e.message }) : { message: (e as Error).message })
