type LockInfo = { upToDate: boolean | null; error?: string | null; lock?: string | null; note?: string | null }

// Замок и подпись «только после завершения закачек» видны, лишь когда обновление реально есть и заблокировано.
// У актуального образа, при ошибке проверки или без проверки их нет (торренты качаются постоянно). Сама защита — на сервере.
export function lockHints(d: LockInfo): { lock: string | null; note: string | null } {
  const blocked = d.upToDate === false && !d.error && !!d.lock
  return { lock: blocked ? (d.lock ?? null) : null, note: blocked ? (d.note ?? null) : null }
}
