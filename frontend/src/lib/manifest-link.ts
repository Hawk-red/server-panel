// Иконка на экране «Домой» (iPad, Safari → «Открыть как веб-приложение») открывает start_url из манифеста.
// Манифест панели динамический: для каждой страницы свой адрес /manifest.webmanifest?start=…&name=…,
// поэтому иконка ведёт именно на ту страницу, с которой её добавили.
import { safeRedirect } from './safe-redirect'

export const MANIFEST_PATH = '/manifest.webmanifest'
export const PANEL_NAME = 'Mac Mini' // имя для страниц вне сайдбара (вход, ТВ-режим, ошибки)

export type NavTitle = { url: string; title: string }

/** Путь с параметрами, как он уйдёт в start_url: только внутренний адрес панели */
export function startPath(pathname: string, searchStr: string): string {
  const search = searchStr && !searchStr.startsWith('?') ? `?${searchStr}` : searchStr
  return safeRedirect(`${pathname}${search}`)
}

/** Имя страницы: заголовок раздела из сайдбара; у «Универсального пульта» с универсальным пультом — «Пульт» */
export function pageName(pathname: string, searchStr: string, nav: readonly NavTitle[]): string {
  if (pathname === '/media-control') {
    // вкладка по умолчанию — универсальный пульт (parseMediaTab), поэтому адрес без ?tab= тоже «Пульт»
    const tab = new URLSearchParams(searchStr.startsWith('?') ? searchStr.slice(1) : searchStr).get('tab')
    if (tab === null || tab === '' || tab === 'universal') return 'Пульт'
  }
  // то же сопоставление раздела по адресу, что в заголовке страницы (components/layout/page.tsx)
  const hit = nav.find(({ url }) => (url === '/' ? pathname === '/' : pathname === url || pathname.startsWith(`${url}/`)))
  return hit?.title ?? PANEL_NAME
}

/** Адрес манифеста для текущего маршрута */
export function manifestHref(pathname: string, searchStr: string, name: string): string {
  const params = new URLSearchParams({ start: startPath(pathname, searchStr), name })
  return `${MANIFEST_PATH}?${params}`
}
