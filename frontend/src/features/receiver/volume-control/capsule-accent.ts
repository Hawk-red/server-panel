// Акцентный цвет «Капсулы» в развёрнутом виде: 8 насыщенных, но не кислотных цветов, хорошо читаемых
// на тёмном фоне. Выбор листается горизонтальным свайпом по кругу и хранится в localStorage (общий для
// всех мест, где показана «Капсула»), чтобы не сбрасывался между открытиями.
import { useCallback, useEffect, useState } from 'react'

export const CAPSULE_ACCENTS = [
  '#22d3ee', // циан — цвет по умолчанию, как у «активного» состояния обычного регулятора
  '#34d399', // изумрудный
  '#a3e635', // лаймовый
  '#fbbf24', // янтарный
  '#fb7185', // розовый
  '#c084fc', // фиолетовый
  '#60a5fa', // синий
  '#f472b6', // малиновый
] as const

const KEY = 'receiver.capsuleAccent'

function readIndex(): number {
  try {
    const v = Number(localStorage.getItem(KEY))
    return Number.isInteger(v) && v >= 0 && v < CAPSULE_ACCENTS.length ? v : 0
  } catch {
    return 0
  }
}

/** Текущий акцент «Капсулы» и переключение по кругу (свайпом); индекс сохраняется в localStorage */
export function useCapsuleAccent() {
  const [index, setIndex] = useState(readIndex)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, String(index))
    } catch {
      // приватный режим/хранилище недоступно — просто не переживёт перезагрузку
    }
  }, [index])
  const cycle = useCallback((dir: 1 | -1) => {
    setIndex((i) => (i + dir + CAPSULE_ACCENTS.length) % CAPSULE_ACCENTS.length)
  }, [])
  return { accent: CAPSULE_ACCENTS[index], cycle }
}
