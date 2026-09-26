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
  return parseEnv(readFileSync(ENV_FILE, 'utf8'))
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
  sessionDays: 30,
  loginMaxFailures: 5,
  loginWindowMin: 15,
}
