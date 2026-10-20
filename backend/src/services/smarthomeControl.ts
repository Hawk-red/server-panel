// Ограничитель частоты управления: не больше max вызовов за окно (скользящее), на всю панель
export function createRateLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const stamps: number[] = []
  return {
    take(): boolean {
      const t = now()
      while (stamps.length > 0 && t - stamps[0] >= windowMs) stamps.shift()
      if (stamps.length >= max) return false
      stamps.push(t)
      return true
    },
  }
}
