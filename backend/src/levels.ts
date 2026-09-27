// Пороги как во фронте (lib/levels.ts): < 70 ok, 70–85 warn, > 85 danger
export function percentLevel(v: number, direction: 'higher-worse' | 'higher-better' = 'higher-worse') {
  if (direction === 'higher-better') return v < 15 ? 'danger' : v <= 30 ? 'warn' : 'ok'
  return v > 85 ? 'danger' : v >= 70 ? 'warn' : 'ok'
}
