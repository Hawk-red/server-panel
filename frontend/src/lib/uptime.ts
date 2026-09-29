// Этап 10 (п.2): один общий запрос /api/uptime — карточки читают его из кэша React Query, без лишних обращений к API
import { useQuery } from '@tanstack/react-query'
import type { MonitorBars, UptimeResponse } from '@/features/infra-types'
import { api } from './api'

export function useUptime() {
  return useQuery({
    queryKey: ['uptime'],
    queryFn: async () => (await api.get<UptimeResponse>('/uptime')).data,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

export function useMonitor(id: string): MonitorBars | undefined {
  const { data } = useUptime()
  return data?.monitors.find((m) => m.id === id)
}
