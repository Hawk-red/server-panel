// Мини-клиент HTTP с таймаутом для локальных сервисов (fetch из Node 20)
import { maskSecrets } from './mask.js'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

export async function http(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 8000, ...rest } = init
  // В URL может быть секрет (api.telegram.org/bot<токен>/…) — в текст ошибки путь попадает только замаскированным
  let res: Response
  try {
    res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    throw new Error(maskSecrets(e instanceof Error ? e.message : String(e)))
  }
  if (!res.ok) throw new HttpError(res.status, `${res.status} ${res.statusText} ← ${maskSecrets(new URL(url).pathname)}`)
  return res
}

export async function httpJson<T>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  return (await http(url, init)).json() as Promise<T>
}
