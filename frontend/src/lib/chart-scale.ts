// «Круглый» верх шкалы графика скорости: ближайшее сверху число вида 1/2/5 × 2^(10k) (Б, КБ, МБ — как formatBytes),
// чтобы подписи на оси были читаемыми («2 МБ/с», а не «1.7 МБ/с»), а линия не упиралась в потолок.
export function niceCeil(value: number): number {
  if (!(value > 0)) return 1024
  let unit = 1
  while (value / unit >= 1024) unit *= 1024
  for (const m of [1, 2, 5, 10, 20, 50, 100, 200, 500]) {
    if (m * unit >= value) return m * unit
  }
  return 1024 * unit
}
