// Мини-клиент HTTP с таймаутом для локальных сервисов (fetch из Node 20)
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
  const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new HttpError(res.status, `${res.status} ${res.statusText} ← ${new URL(url).pathname}`)
  return res
}

export async function httpJson<T>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  return (await http(url, init)).json() as Promise<T>
}
