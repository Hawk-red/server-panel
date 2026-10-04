import http from 'node:http'
import { statfs } from 'node:fs/promises'
import { run } from '../exec.js'

// Локальный движок Ollama: только 127.0.0.1, наружу не открыт (OLLAMA_HOST в юните)
export const OLLAMA_UNIT = 'ollama.service'
export const OLLAMA_MODEL = 'qwen2.5-coder:14b'
// Контекст задаём явно: без параметра Ollama грузит модель с 4096 токенами и молча обрезает историю.
// KV-кэш на 8192 токена для этой модели — около 1.5 ГБ RAM сверх весов.
export const OLLAMA_NUM_CTX = 8192
const OLLAMA = new URL('http://127.0.0.1:11434')
const SHORT_TIMEOUT_MS = 2000

// Короткие служебные запросы к API (статус): таймаут есть, чтобы страница не зависала, если Ollama выключена
function getJson<T>(p: string): Promise<T | null> {
  return new Promise((resolve) => {
    const req = http.get(new URL(p, OLLAMA), { timeout: SHORT_TIMEOUT_MS }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c: string) => (body += c))
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null)
        try {
          resolve(JSON.parse(body) as T)
        } catch {
          resolve(null)
        }
      })
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
  })
}

export function postJson<T>(p: string, payload: unknown): Promise<T | null> {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload)
    const req = http.request(
      new URL(p, OLLAMA),
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, timeout: SHORT_TIMEOUT_MS },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c: string) => (body += c))
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null)
          try {
            resolve(JSON.parse(body) as T)
          } catch {
            resolve(null)
          }
        })
      }
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
    req.end(data)
  })
}

export type OllamaTags = { models: { name: string; size: number; details: { parameter_size: string; quantization_level: string; family: string } }[] }
export type OllamaPs = { models: { name: string; size: number; size_vram: number; expires_at: string; context_length?: number }[] }

export const getVersion = () => getJson<{ version: string }>('/api/version')
export const getTags = () => getJson<OllamaTags>('/api/tags')
export const getPs = () => getJson<OllamaPs>('/api/ps')
export const getShow = () =>
  postJson<{ model_info: Record<string, unknown> }>('/api/show', { model: OLLAMA_MODEL })

// Состояние службы: is-active возвращает ненулевой код для остановленной службы — берём stdout
export async function unitState(): Promise<string> {
  return run('/usr/bin/systemctl', ['is-active', OLLAMA_UNIT])
    .then((s) => s.trim())
    .catch((e: { stdout?: string }) => (e.stdout ?? '').trim() || 'unknown')
}

// Свободное место на разделе, где лежат модели (/home/hawk/.ollama на корневом разделе)
export async function freeDisk(): Promise<{ free: number; total: number } | null> {
  const s = await statfs('/').catch(() => null)
  if (!s) return null
  return { free: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) }
}

// Потоковый чат: тело ответа Ollama (NDJSON) отдаётся как есть.
// Таймаутов нет: запрос может идти 10+ минут (промпт на этом CPU обрабатывается медленно).
// Ошибки до ответа (Ollama не слушает) приходят reject'ом; дальше сбой виден как обрыв потока.
export function chatStream(payload: unknown): Promise<{ res: http.IncomingMessage; req: http.ClientRequest }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload)
    const req = http.request(
      new URL('/api/chat', OLLAMA),
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => resolve({ res, req })
    )
    req.setTimeout(0)
    // Слушатель остаётся и после resolve: иначе обрыв посреди потока уронит процесс панели
    req.on('error', reject)
    req.end(data)
  })
}
