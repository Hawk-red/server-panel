// Чат с Ollama: диалог хранится в panel.db, генерация идёт на сервере до конца независимо от браузера.
// Клиент может подключиться к живому потоку (subscribe), отключиться, уйти на другую вкладку — задание не отменяется.
// Отмена — только явным stop().
import type { ServerResponse } from 'node:http'
import { db } from '../db.js'
import * as ollama from './ollama.js'

export type Stats = { tokens: number; tokensPerSec: number; seconds: number }
export type MsgStatus = 'generating' | 'done' | 'stopped' | 'error'
export type ChatMessage = {
  id: number
  role: 'user' | 'assistant'
  content: string
  status: MsgStatus
  error: string | null
  stats: Stats | null
  createdAt: number
  updatedAt: number
}

type Row = { id: number; role: 'user' | 'assistant'; content: string; status: MsgStatus; error: string | null; stats: string | null; created_at: number; updated_at: number }

const FLUSH_MS = 2000 // ответ пишется в базу батчами, а не на каждый токен
const MAX_HISTORY = 100

const q = {
  lastSession: db.prepare(`SELECT id FROM ai_sessions ORDER BY id DESC LIMIT 1`),
  newSession: db.prepare(`INSERT INTO ai_sessions (title, created_at, updated_at) VALUES (NULL, ?, ?)`),
  touchSession: db.prepare(`UPDATE ai_sessions SET updated_at = ? WHERE id = ?`),
  delSessions: db.prepare(`DELETE FROM ai_sessions`),
  insMsg: db.prepare(`INSERT INTO ai_messages (session_id, role, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`),
  messages: db.prepare(`SELECT id, role, content, status, error, stats, created_at, updated_at FROM ai_messages WHERE session_id = ? ORDER BY id`),
  saveContent: db.prepare(`UPDATE ai_messages SET content = ?, updated_at = ? WHERE id = ?`),
  finish: db.prepare(`UPDATE ai_messages SET content = ?, status = ?, error = ?, stats = ?, updated_at = ? WHERE id = ?`),
  staleGen: db.prepare(`UPDATE ai_messages SET status = 'error', error = ?, updated_at = ? WHERE status = 'generating'`),
}

const toMessage = (r: Row): ChatMessage => ({
  id: r.id,
  role: r.role,
  content: r.content,
  status: r.status,
  error: r.error,
  stats: r.stats ? (JSON.parse(r.stats) as Stats) : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

// Панель перезапустилась посреди генерации: задание потеряно, но накопленный текст в базе остаётся
export function recoverStale() {
  q.staleGen.run('панель была перезапущена во время генерации; сохранён уже полученный текст', Date.now())
}

function currentSessionId(create: boolean): number | null {
  const row = q.lastSession.get() as { id: number } | undefined
  if (row) return row.id
  if (!create) return null
  const now = Date.now()
  return Number(q.newSession.run(now, now).lastInsertRowid)
}

type Job = {
  messageId: number
  content: string
  dirty: boolean
  stopped: boolean
  finished: boolean
  startedAt: number
  subscribers: Set<ServerResponse>
  up: Awaited<ReturnType<typeof ollama.chatStream>> | null
  timer: NodeJS.Timeout
}

let job: Job | null = null

export const isGenerating = () => job !== null

export function getState() {
  const sid = currentSessionId(false)
  const messages = sid ? (q.messages.all(sid) as Row[]).map(toMessage) : []
  // Текст идущего ответа берём из памяти: он свежее, чем последний сброс в базу
  if (job) {
    const m = messages.find((x) => x.id === job!.messageId)
    if (m) m.content = job.content
  }
  return { generating: job !== null, startedAt: job?.startedAt ?? null, messages }
}

export function clearChat(): boolean {
  if (job) return false
  q.delSessions.run() // сообщения удаляются каскадом
  return true
}

const send = (j: Job, line: string) => {
  for (const res of j.subscribers) {
    if (res.destroyed || res.writableEnded) j.subscribers.delete(res)
    else res.write(line + '\n')
  }
}

function finalize(j: Job, status: MsgStatus, error: string | null, stats: Stats | null) {
  if (j.finished) return
  j.finished = true
  clearInterval(j.timer)
  q.finish.run(j.content, status, error, stats ? JSON.stringify(stats) : null, Date.now(), j.messageId)
  if (error) send(j, JSON.stringify({ error }))
  for (const res of j.subscribers) if (!res.destroyed && !res.writableEnded) res.end()
  j.subscribers.clear()
  if (job === j) job = null
}

// Подключает браузер к живому потоку. Закрытие соединения клиентом задание НЕ отменяет.
export function subscribe(res: ServerResponse) {
  if (!job) return false
  job.subscribers.add(res)
  const j = job
  res.on('close', () => j.subscribers.delete(res))
  return true
}

export function stop(): boolean {
  if (!job) return false
  job.stopped = true
  const j = job
  j.up?.req.destroy()
  setTimeout(() => finalize(j, 'stopped', null, null), 3000) // страховка, если обрыв соединения не вызовет событий
  // Если соединения с Ollama ещё нет (идёт загрузка модели), завершаем сразу: start() увидит stopped и закроет запрос
  if (!job.up) finalize(job, 'stopped', null, null)
  return true
}

// Создаёт сообщения и запускает генерацию в фоне. Вызывающий затем делает subscribe(res).
export function start(text: string, system: string | null): { ok: true } | { ok: false; reason: 'busy' } {
  if (job) return { ok: false, reason: 'busy' }
  const sid = currentSessionId(true)!
  const now = Date.now()
  q.insMsg.run(sid, 'user', text, 'done', now, now)
  const messageId = Number(q.insMsg.run(sid, 'assistant', '', 'generating', now, now).lastInsertRowid)
  q.touchSession.run(now, sid)

  const j: Job = { messageId, content: '', dirty: false, stopped: false, finished: false, startedAt: now, subscribers: new Set(), up: null, timer: null as unknown as NodeJS.Timeout }
  j.timer = setInterval(() => {
    if (j.dirty && !j.finished) {
      j.dirty = false
      q.saveContent.run(j.content, Date.now(), j.messageId)
    }
  }, FLUSH_MS)
  job = j

  // История для модели собирается на сервере из базы (без самого пустого ответа, который сейчас генерируется)
  const history = (q.messages.all(sid) as Row[])
    .filter((r) => r.id !== messageId && (r.role === 'user' || r.content !== ''))
    .slice(-MAX_HISTORY)
    .map((r) => ({ role: r.role, content: r.content }))
  const messages = [...(system ? [{ role: 'system', content: system }] : []), ...history]

  void run(j, messages)
  return { ok: true }
}

async function run(j: Job, messages: unknown[]) {
  let up: Awaited<ReturnType<typeof ollama.chatStream>>
  try {
    up = await ollama.chatStream({ model: ollama.OLLAMA_MODEL, messages, stream: true, options: { num_ctx: ollama.OLLAMA_NUM_CTX } })
  } catch {
    return finalize(j, 'error', 'Ollama не запущена — нажмите «Запустить» слева', null)
  }
  if (j.finished) return up.req.destroy() // «Стоп» нажали, пока модель загружалась
  j.up = up
  if (j.stopped) return up.req.destroy()

  if (up.res.statusCode !== 200) {
    let body = ''
    up.res.setEncoding('utf8')
    for await (const chunk of up.res) body += chunk
    let text = ''
    try {
      text = (JSON.parse(body) as { error?: string }).error ?? ''
    } catch {
      text = body.slice(0, 300)
    }
    return finalize(j, 'error', text || `Ollama ответила кодом ${up.res.statusCode}`, null)
  }

  let buf = ''
  let stats: Stats | null = null
  let ollamaError: string | null = null
  up.res.setEncoding('utf8')
  up.res.on('data', (chunk: string) => {
    buf += chunk
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      try {
        const ev = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string; eval_count?: number; eval_duration?: number; total_duration?: number }
        if (ev.error) ollamaError = ev.error
        const piece = ev.message?.content
        if (piece) {
          j.content += piece
          j.dirty = true
          send(j, line) // живой поток в браузер в том же формате, что у Ollama
        }
        if (ev.done) {
          const tokens = ev.eval_count ?? 0
          stats = { tokens, tokensPerSec: ev.eval_duration ? tokens / (ev.eval_duration / 1e9) : 0, seconds: (ev.total_duration ?? 0) / 1e9 }
          send(j, line)
        }
      } catch {
        /* битую строку пропускаем */
      }
    }
  })
  const end = () => {
    if (j.stopped) return finalize(j, 'stopped', null, null)
    if (ollamaError) return finalize(j, 'error', ollamaError, null)
    if (stats) return finalize(j, 'done', null, stats)
    finalize(j, 'error', 'поток от Ollama оборвался (возможно, служба была остановлена)', null)
  }
  up.res.on('end', end)
  up.res.on('error', end)
  up.res.on('close', end) // finalize идемпотентен
}
