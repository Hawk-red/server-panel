// Маскирование секретов в текстах ошибок, журналах и ответах API.
// Токен Telegram-бота: «123456789:AA…» (35+ символов после двоеточия), в URL — /bot<токен>/.
const BOT_PATH = /\/bot\d{5,12}:[A-Za-z0-9_-]{30,}/g
const BOT_TOKEN = /\b\d{5,12}:[A-Za-z0-9_-]{30,}/g
const HAS_TOKEN = /\d{5,12}:[A-Za-z0-9_-]{30,}/
// Токен доступа Home Assistant (JWT: три части base64url через точку) и заголовок Authorization
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}=*/gi
const HAS_JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+\/-]{16,}/i

export const hasSecret = (s: string) => HAS_TOKEN.test(s) || HAS_JWT.test(s)

export function maskSecrets(s: string): string {
  if (!hasSecret(s)) return s
  return s.replace(BOT_PATH, '/bot<скрыто>').replace(BOT_TOKEN, '<токен скрыт>').replace(BEARER, 'Bearer <токен скрыт>').replace(JWT, '<токен скрыт>')
}

// Текст ошибки без секретов — для ответов, журнала действий и логов
export const errText = (e: unknown) => maskSecrets(e instanceof Error ? e.message : String(e))
