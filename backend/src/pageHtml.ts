// HTML страницы панели с тегами под её адрес. Safari читает <link rel="manifest">, <title> и
// apple-mobile-web-app-title из первого ответа сервера, до запуска JS, — поэтому клиентской подмены
// (frontend/src/hooks/use-manifest-link.ts) для «На экран Домой» мало: иконка берёт манифест исходного
// документа, то есть главную. Здесь те же три тега подставляются в собранный index.html на сервере.
// Клиентский хук остаётся нужным при переходах внутри SPA — там новой загрузки HTML не происходит.
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { MANIFEST_PATH, safeName, safeStart } from './manifest.js'

export const PANEL_NAME = 'Mac Mini' // страницы вне сайдбара: вход, ТВ-режим, ошибки

// Копия таблицы разделов из frontend/src/components/layout/data/sidebar-data.ts (адрес → заголовок).
// Нужна здесь, потому что имя подставляется до запуска JS. Появился раздел в сайдбаре — добавьте и сюда;
// за совпадением с фронтом следит тест pageHtml.test.ts.
export const PAGE_NAMES: readonly (readonly [string, string])[] = [
  ['/', 'Обзор'],
  ['/system', 'Система'],
  ['/disks', 'Диски'],
  ['/updates', 'Обновления'],
  ['/backups', 'Бэкапы'],
  ['/git', 'Git'],
  ['/notifications', 'Уведомления'],
  ['/media-control', 'Медиа'],
  ['/media', 'Медиа-серверы'],
  ['/smarthome', 'Умный дом'],
  ['/homeassistant', 'Home Assistant'],
  ['/torrents', 'Торренты'],
  ['/adguard', 'AdGuard Home'],
  ['/docker', 'Docker'],
  ['/ai', 'Локальный AI'],
  ['/sites', 'Сайты и API'],
  ['/telegram', 'Telegram-боты'],
  ['/internet', 'Интернет'],
  ['/wireless', 'Беспроводные'],
  ['/access', 'SSH и доступ'],
  ['/security', 'Безопасность'],
  ['/network', 'Сеть и устройства'],
  ['/audit', 'Журнал действий'],
]

export function splitUrl(url: string): { pathname: string; search: string } {
  const i = url.indexOf('?')
  return i === -1 ? { pathname: url, search: '' } : { pathname: url.slice(0, i), search: url.slice(i) }
}

// Имя страницы по адресу — то же правило, что во фронтовом src/lib/manifest-link.ts
export function pageName(pathname: string, search: string): string {
  if (pathname === '/media-control') {
    // вкладка по умолчанию — универсальный пульт, поэтому адрес без ?tab= тоже «Пульт»
    const tab = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('tab')
    if (tab === null || tab === '' || tab === 'universal') return 'Пульт'
  }
  const hit = PAGE_NAMES.find(([url]) => (url === '/' ? pathname === '/' : pathname === url || pathname.startsWith(`${url}/`)))
  return hit?.[1] ?? PANEL_NAME
}

// Расширение файла в конце пути; до 12 символов — чтобы «.webmanifest» тоже считался файлом, а не страницей
const FILE_RE = /\.[a-z0-9]{2,12}$/i
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Запрос самой страницы (а не файла и не API): его HTML собирается под адрес. Файлы с расширением
// (/assets/*.js, /offline.html, /images/*.png, /manifest.webmanifest) отдаёт статика как раньше
export function isPageRequest(method: string, url: string, accept: string | undefined): boolean {
  if (method !== 'GET') return false
  const { pathname } = splitUrl(url)
  if (pathname.startsWith('/api/')) return false
  if (pathname !== '/' && pathname !== '/index.html' && FILE_RE.test(pathname)) return false
  // Браузер при переходе просит text/html; curl и скрипты — */*: им отдаём то же самое, чтобы страница была одна
  const a = accept ?? ''
  return a.includes('text/html') || a.includes('*/*')
}

// Три тега заменяются по месту: остальной index.html (иконки, apple-touch-icon, цвета, описание) не меняется
export function injectPageTags(html: string, start: string, name: string): string {
  const title = escapeHtml(name)
  const href = escapeHtml(`${MANIFEST_PATH}?${new URLSearchParams({ start, name })}`)
  return html
    .replace(/(<link\b[^>]*\brel="manifest"[^>]*\bhref=")[^"]*(")/i, (_m, a: string, b: string) => a + href + b)
    .replace(/<title>[^<]*<\/title>/i, () => `<title>${title}</title>`)
    .replace(/(<meta\b[^>]*\bname="apple-mobile-web-app-title"[^>]*\bcontent=")[^"]*(")/i, (_m, a: string, b: string) => a + title + b)
}

let cached: { mtimeMs: number; html: string } | undefined

// Собранный index.html; перечитывается после пересборки фронта (по mtime), как и статика
export function indexHtml(): string | undefined {
  const file = path.join(config.staticDir, 'index.html')
  try {
    const { mtimeMs } = statSync(file)
    if (cached?.mtimeMs !== mtimeMs) cached = { mtimeMs, html: readFileSync(file, 'utf8') }
    return cached.html
  } catch {
    return undefined // фронт не собран
  }
}

// Готовый HTML для адреса запроса (path + query). undefined — фронт не собран, отдавать нечего
export function renderPage(url: string): string | undefined {
  const html = indexHtml()
  if (html === undefined) return undefined
  const { pathname, search } = splitUrl(url)
  return injectPageTags(html, safeStart(pathname + search), safeName(pageName(pathname, search), PANEL_NAME))
}
