import { useEffect } from 'react'
import { useLocation } from '@tanstack/react-router'
import { sidebarData } from '@/components/layout/data/sidebar-data'
import { manifestHref, pageName, type NavTitle } from '@/lib/manifest-link'

// Заголовки разделов — из того же списка, что рисует сайдбар
const NAV: NavTitle[] = sidebarData.navGroups.flatMap((g) =>
  g.items.filter((i) => i.url).map((i) => ({ url: String(i.url), title: i.title }))
)

// На каждой смене маршрута переписываем <link rel="manifest">, <title> и apple-mobile-web-app-title:
// в диалоге «На экран Домой» имя страницы подставляется само, а иконка открывает её, а не «Обзор».
// Остальные теги (apple-touch-icon, цвета, описание) не трогаются — они в index.html.
export function useManifestLink() {
  const { pathname, searchStr } = useLocation()
  useEffect(() => {
    const name = pageName(pathname, searchStr, NAV)
    document.title = name
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    if (link) link.setAttribute('href', manifestHref(pathname, searchStr, name))
    const meta = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')
    if (meta) meta.setAttribute('content', name)
  }, [pathname, searchStr])
}
