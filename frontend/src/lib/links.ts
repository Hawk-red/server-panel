import { queryOptions, useQuery } from '@tanstack/react-query'
import { api } from './api'

// Адреса веб-интерфейсов служб приходят с сервера (/api/links): панель может быть открыта по panel.pulsdev.net:9443, где портов
// служб нет, поэтому ссылки НЕ строятся из адреса страницы. Снаружи сервер отдаёт null — ссылки становятся неактивными.
export type LinkTarget = { origin: string; path: string }
export type LinksData = { internal: boolean; lanHost: string | null; services: Record<string, LinkTarget | null> }

export const HOME_ONLY_HINT = 'Доступно только из домашней сети или через WireGuard'

export const linksQuery = queryOptions({
  queryKey: ['links'],
  queryFn: async () => (await api.get<LinksData>('/links')).data,
  staleTime: 5 * 60 * 1000,
  retry: false,
})

/** Хук ссылок: internal — undefined, пока ответ не пришёл; href(id, path) — адрес службы или null (недоступно с этого адреса) */
export function useLinks() {
  const { data } = useQuery(linksQuery)
  return {
    loaded: Boolean(data),
    internal: data?.internal,
    lanHost: data?.lanHost ?? null,
    href(id: string, path?: string): string | null {
      const t = data?.services[id]
      if (!t) return null
      return `${t.origin}${path ?? t.path}`
    },
  }
}
