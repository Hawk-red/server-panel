// Маскирование секретов в текстах ошибок, журналах и ответах API.
// Токен Telegram-бота: «123456789:AA…» (35+ символов после двоеточия), в URL — /bot<токен>/.
const BOT_PATH = /\/bot\d{5,12}:[A-Za-z0-9_-]{30,}/g
const BOT_TOKEN = /\b\d{5,12}:[A-Za-z0-9_-]{30,}/g
const HAS_TOKEN = /\d{5,12}:[A-Za-z0-9_-]{30,}/

export const hasSecret = (s: string) => HAS_TOKEN.test(s)

export function maskSecrets(s: string): string {
  if (!hasSecret(s)) return s
  return s.replace(BOT_PATH, '/bot<скрыто>').replace(BOT_TOKEN, '<токен скрыт>')
}

// Текст ошибки без секретов — для ответов, журнала действий и логов
export const errText = (e: unknown) => maskSecrets(e instanceof Error ? e.message : String(e))
