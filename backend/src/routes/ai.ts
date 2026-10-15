import type { FastifyInstance } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import { getSetting, setSetting } from '../settings.js'
import { AI_DEFAULT_CONTEXT, AI_DEFAULT_PROMPT } from '../services/ai-defaults.js'
import * as aiChat from '../services/aiChat.js'
import * as ollama from '../services/ollama.js'

const MAX_TEXT = 8000
const MAX_MESSAGE_CHARS = 20000

type AiSettings = { promptEnabled: boolean; prompt: string; contextEnabled: boolean; context: string }

function readSettings(): AiSettings {
  return {
    promptEnabled: getSetting<boolean>('ai.prompt.enabled', true),
    prompt: getSetting<string>('ai.prompt.text', AI_DEFAULT_PROMPT),
    contextEnabled: getSetting<boolean>('ai.context.enabled', false),
    context: getSetting<string>('ai.context.text', AI_DEFAULT_CONTEXT),
  }
}

// Системное сообщение собирается на сервере: клиент его не передаёт и не может подменить
function systemMessage(s: AiSettings): string | null {
  const parts: string[] = []
  if (s.promptEnabled && s.prompt.trim()) parts.push(s.prompt.trim())
  if (s.contextEnabled && s.context.trim()) parts.push(`Справка о сервере:\n${s.context.trim()}`)
  return parts.length ? parts.join('\n\n') : null
}

const who = (ip: string) => ({ ip, user: 'admin' })

export async function aiRoutes(app: FastifyInstance) {
  aiChat.recoverStale() // после перезапуска панели «генерирующиеся» ответы из прошлого процесса помечаются ошибкой
  app.addHook('preHandler', requireAuth)

  app.get('/api/ai/status', async () => {
    const [service, version, tags, ps, show, disk] = await Promise.all([
      ollama.unitState(),
      ollama.getVersion(),
      ollama.getTags(),
      ollama.getPs(),
      ollama.getShow(),
      ollama.freeDisk(),
    ])
    const info = tags?.models.find((m) => m.name === ollama.OLLAMA_MODEL) ?? null
    const loaded = ps?.models.find((m) => m.name === ollama.OLLAMA_MODEL) ?? null
    const ctx = show?.model_info ? Number(show.model_info['qwen2.context_length']) || null : null
    return {
      service: { unit: ollama.OLLAMA_UNIT, active: service },
      engine: { name: 'Ollama', version: version?.version ?? null },
      model: info
        ? {
            name: ollama.OLLAMA_MODEL,
            parameters: info.details.parameter_size,
            quantization: info.details.quantization_level,
            family: info.details.family,
            sizeBytes: info.size,
            contextLength: ctx,
          }
        : null,
      // Загружена ли модель в память сейчас (выгружается через OLLAMA_KEEP_ALIVE после простоя)
      loaded: loaded
        ? { sizeBytes: loaded.size, vramBytes: loaded.size_vram, expiresAt: loaded.expires_at, contextLength: loaded.context_length ?? null }
        : null,
      numCtx: ollama.OLLAMA_NUM_CTX,
      disk,
    }
  })

  app.get('/api/ai/settings', async () => ({ ...readSettings(), defaults: { prompt: AI_DEFAULT_PROMPT, context: AI_DEFAULT_CONTEXT } }))

  app.put<{ Body: Partial<AiSettings> }>(
    '/api/ai/settings',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            promptEnabled: { type: 'boolean' },
            prompt: { type: 'string', maxLength: MAX_TEXT },
            contextEnabled: { type: 'boolean' },
            context: { type: 'string', maxLength: MAX_TEXT },
          },
        },
      },
    },
    async (req) => {
      const b = req.body
      if (b.promptEnabled !== undefined) setSetting('ai.prompt.enabled', b.promptEnabled)
      if (b.prompt !== undefined) setSetting('ai.prompt.text', b.prompt)
      if (b.contextEnabled !== undefined) setSetting('ai.context.enabled', b.contextEnabled)
      if (b.context !== undefined) setSetting('ai.context.text', b.context)
      // В журнал пишем только факт изменения, без текста промпта
      audit({ ...who(req.clientIp), action: 'ai.settings', result: 'ok', details: { fields: Object.keys(b) } })
      return readSettings()
    }
  )

  // Состояние диалога: вся история и идущий (возможно, ещё генерируемый) ответ. Фронт опрашивает его при открытии страницы,
  // при возврате на вкладку и пока генерация идёт.
  app.get('/api/ai/chat', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store')
    return aiChat.getState()
  })

  // Новый вопрос. Сообщения сохраняются сразу, генерация идёт на сервере до конца независимо от клиента.
  // Ответ — живой NDJSON-поток (формат Ollama) для активной вкладки; обрыв соединения генерацию НЕ отменяет.
  app.post<{ Body: { text: string } }>(
    '/api/ai/chat',
    {
      bodyLimit: 256 * 1024,
      schema: { body: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: MAX_MESSAGE_CHARS } } } },
    },
    async (req, reply) => {
      const text = req.body.text.trim()
      if (!text) return reply.code(400).send({ message: 'пустое сообщение' })
      const r = aiChat.start(text, systemMessage(readSettings()))
      if (!r.ok) return reply.code(409).send({ message: 'Модель ещё отвечает на предыдущий вопрос' })

      // Отдаём поток сами: onSend-хуки Fastify для hijacked-ответа не работают, заголовки ставим явно
      reply.hijack()
      req.raw.socket.setTimeout(0)
      reply.raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Accel-Buffering': 'no',
      })
      reply.raw.flushHeaders() // заголовки уходят сразу: клиент понимает, что вопрос принят и сохранён
      if (!aiChat.subscribe(reply.raw)) reply.raw.end()
    }
  )

  // Единственный способ отменить генерацию — явная кнопка «Стоп»
  app.post('/api/ai/chat/stop', async (req) => {
    const stopped = aiChat.stop()
    if (stopped) audit({ ...who(req.clientIp), action: 'ai.chat.stop', result: 'ok' })
    return { stopped }
  })

  app.delete('/api/ai/chat', async (_req, reply) => {
    if (!aiChat.clearChat()) return reply.code(409).send({ message: 'Идёт генерация — сначала нажмите «Стоп»' })
    return { ok: true }
  })
}
