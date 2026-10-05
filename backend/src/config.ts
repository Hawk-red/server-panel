import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const ENV_FILE = process.env.PANEL_ENV_FILE ?? path.join(BACKEND_DIR, '.env')

// Простой парсер .env: KEY=VALUE, без подстановок (в argon2-хэше есть '$')
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    let value = line.slice(eq + 1).trim()
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1)
    out[line.slice(0, eq).trim()] = value
  }
  return out
}

function loadEnv(): Record<string, string> {
  if (!existsSync(ENV_FILE)) return {}
  try {
    return parseEnv(readFileSync(ENV_FILE, 'utf8'))
  } catch {
    return {} // нет прав (скрипты, запущенные не от panel) — работаем со значениями по умолчанию
  }
}

const env = { ...loadEnv(), ...process.env } as Record<string, string | undefined>

const pkg = JSON.parse(readFileSync(path.join(BACKEND_DIR, 'package.json'), 'utf8'))

export const config = {
  version: pkg.version as string,
  host: env.HOST ?? '0.0.0.0',
  port: Number(env.PORT ?? 7575),
  dataDir: env.DATA_DIR ?? path.resolve(BACKEND_DIR, '..', 'data'),
  staticDir: env.STATIC_DIR ?? path.resolve(BACKEND_DIR, '..', 'frontend', 'dist'),
  passwordHash: env.PANEL_PASSWORD_HASH ?? '',
  // Сети, из которых разрешён доступ (второй рубеж после ufw)
  allowedNets: (env.ALLOWED_NETS ?? '127.0.0.0/8,192.168.31.0/24,10.10.10.0/24')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // Внешние сервисы (секреты — только в .env, на фронт не уходят)
  dockerProxy: env.DOCKER_PROXY ?? 'http://127.0.0.1:2375',
  qbt: { url: env.QBT_URL ?? 'http://127.0.0.1:8090', user: env.QBT_USER ?? '', password: env.QBT_PASSWORD ?? '' },
  adguard: { url: env.ADGUARD_URL ?? 'http://127.0.0.1:3000', user: env.ADGUARD_USER ?? '', password: env.ADGUARD_PASSWORD ?? '' },
  jellyfin: { url: env.JELLYFIN_URL ?? 'http://127.0.0.1:8096', apiKey: env.JELLYFIN_API_KEY ?? '' },
  // Веб-интерфейс ресивера — порт 80 (/ → index.asp → top.asp); на :8080 только заглушка UPnP
  marantz: { host: env.MARANTZ_HOST ?? '192.168.31.94', webPort: 80 },
  torrentsDir: env.TORRENTS_DIR ?? '/home/torrents-tmp',
  // Бот уведомлений (этап 10.1); chat_id и правила — в настройках панели
  notifyToken: env.NOTIFY_BOT_TOKEN ?? '',
  sessionDays: 30,
  externalSessionHours: 12, // сессия, созданная из интернета: короче и без продления
  loginMaxFailures: 5,
  loginWindowMin: 15,
}
