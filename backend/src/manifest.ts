// Манифест PWA по адресу текущей страницы. Нужен для иконок на экране «Домой» iPad: Safari берёт из манифеста
// start_url, поэтому со статичным манифестом («/») любая иконка открывала «Обзор». Здесь start_url и id берутся
// из запроса, а всё остальное (иконки, цвета, display, scope) копируется из собранного статичного манифеста.
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

export const MANIFEST_PATH = '/manifest.webmanifest'

export type ManifestBase = Record<string, unknown>

const MAX_START = 200 // путь длиннее — явно не адрес страницы панели
const MAX_NAME = 20 // имя под иконкой всё равно обрезается системой

// Если фронт не собран или файл испорчен — отдаём то же, что лежит в frontend/public/manifest.webmanifest
export const MANIFEST_DEFAULT: ManifestBase = {
  name: 'Mac Mini — панель сервера',
  short_name: 'Mac Mini',
  description: 'Панель администрирования домашнего сервера',
  lang: 'ru',
  display: 'standalone',
  orientation: 'any',
  background_color: '#0f172a',
  theme_color: '#0f172a',
  icons: [
    { src: '/images/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/images/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/images/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/images/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}

// Адрес, который попадёт в start_url: только внутренний путь панели — та же проверка, что у safeRedirect
// на фронте (frontend/src/lib/safe-redirect.ts). Внешний адрес, «//evil.com», «/\evil.com», управляющие
// символы и слишком длинная строка заменяются на «/»: иконка откроет «Обзор», но не чужой сайт.
export function safeStart(value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.length > MAX_START) return '/'
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/'
  if ([...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return '/'
  return value
}

// Имя под иконкой: управляющие символы убираем (в JSON они недопустимы в сыром виде, остальное экранирует
// JSON.stringify), режем по символам, а не по единицам кода, чтобы не разорвать эмодзи
export function safeName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const clean = [...value]
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    .slice(0, MAX_NAME)
    .join('')
    .trim()
  return clean || fallback
}

// scope остаётся «/»: переходы по панели внутри окна приложения, а не в браузере.
// id = start_url, иначе iOS считает иконки разных страниц одним приложением и открывает одну и ту же
export function buildManifest(base: ManifestBase, start: string, name: string): ManifestBase {
  return { ...base, id: start, start_url: start, name, short_name: name, scope: '/' }
}

let cached: { mtimeMs: number; base: ManifestBase } | undefined

// Статичный манифест из сборки фронта — источник иконок и цветов (пересборка подхватывается по mtime)
export function manifestBase(): ManifestBase {
  const file = path.join(config.staticDir, 'manifest.webmanifest')
  try {
    const { mtimeMs } = statSync(file)
    if (cached?.mtimeMs !== mtimeMs) {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return MANIFEST_DEFAULT
      cached = { mtimeMs, base: parsed as ManifestBase }
    }
    return cached.base
  } catch {
    return MANIFEST_DEFAULT
  }
}

// Готовый манифест для запроса ?start=…&name=…
export function manifestFor(start: unknown, name: unknown): ManifestBase {
  const base = manifestBase()
  const fallback = typeof base.short_name === 'string' && base.short_name ? base.short_name : String(MANIFEST_DEFAULT.short_name)
  return buildManifest(base, safeStart(start), safeName(name, fallback))
}
