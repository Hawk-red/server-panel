import type { FastifyInstance } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import { getSetting, setSetting } from '../settings.js'
import { AI_DEFAULT_CONTEXT, AI_DEFAULT_PROMPT } from '../services/ai-defaults.js'
import * as ollama from '../services/ollama.js'

const MAX_TEXT = 8000
const MAX_MESSAGES = 100
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

  // Потоковый чат. Тело ответа Ollama (NDJSON) идёт в браузер насквозь, без буферизации.
  app.post<{ Body: { messages: { role: 'user' | 'assistant'; content: string }[] } }>(
    '/api/ai/chat',
    {
      // История диалога может быть больше глобального лимита 64 КБ
      bodyLimit: 2 * 1024 * 1024,
      schema: {
        body: {
          type: 'object',
          required: ['messages'],
          properties: {
            messages: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_MESSAGES,
              items: {
                type: 'object',
                required: ['role', 'content'],
                properties: {
                  role: { type: 'string', enum: ['user', 'assistant'] },
                  content: { type: 'string', maxLength: MAX_MESSAGE_CHARS },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const sys = systemMessage(readSettings())
      const messages = [...(sys ? [{ role: 'system', content: sys }] : []), ...req.body.messages]

      let up: Awaited<ReturnType<typeof ollama.chatStream>>
      try {
        up = await ollama.chatStream({ model: ollama.OLLAMA_MODEL, messages, stream: true, options: { num_ctx: ollama.OLLAMA_NUM_CTX } })
      } catch {
        return reply.code(503).send({ message: 'Ollama не запущена — нажмите «Запустить» выше' })
      }

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
        return reply.code(502).send({ message: text || `Ollama ответила кодом ${up.res.statusCode}` })
      }

      // Отдаём поток сами: onSend-хуки Fastify для hijacked-ответа не работают, заголовки ставим явно
      reply.hijack()
      req.raw.socket.setTimeout(0)
      reply.raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Accel-Buffering': 'no',
      })

      // Браузер закрыл вкладку или нажал «Стоп» — отменяем генерацию в Ollama, чтобы не занимать CPU
      reply.raw.on('close', () => {
        if (!reply.raw.writableFinished) up.req.destroy()
      })
      up.res.on('error', () => reply.raw.destroy())
      up.res.pipe(reply.raw)
    }
  )
}
