import { Clapperboard, Flame, Gamepad2, Laptop, Lightbulb, Monitor, Power, Radio, Smartphone, Sparkles, Tv, Volume2 } from 'lucide-react'
import type { SceneColor, SceneIcon } from '@/lib/smarthome'

// Цвета плиток сцен (классы заданы целиком, чтобы Tailwind их не вырезал)
export const SCENE_BG: Record<SceneColor, string> = {
  green: 'bg-green-600', red: 'bg-red-600', magenta: 'bg-fuchsia-600', blue: 'bg-blue-600', brown: 'bg-amber-800',
  emerald: 'bg-emerald-600', violet: 'bg-violet-600', orange: 'bg-orange-500', slate: 'bg-slate-600', cyan: 'bg-cyan-600',
}
export const SCENE_COLOR_LABEL: Record<SceneColor, string> = {
  green: 'Зелёный', red: 'Красный', magenta: 'Пурпурный', blue: 'Синий', brown: 'Коричневый', emerald: 'Изумрудный', violet: 'Фиолетовый', orange: 'Оранжевый', slate: 'Серо-синий', cyan: 'Бирюзовый',
}
export const SCENE_ICON: Record<SceneIcon, typeof Tv> = {
  tv: Tv, power: Power, clapperboard: Clapperboard, flame: Flame, radio: Radio, laptop: Laptop, gamepad: Gamepad2, smartphone: Smartphone, lightbulb: Lightbulb, volume: Volume2, monitor: Monitor, sparkles: Sparkles,
}
