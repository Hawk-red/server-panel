import { useCallback, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { isUgoosRepeatable, type UgoosStatus } from '@/lib/ugoos-pad'

const msg = (e: unknown, fallback: string) => ((e instanceof AxiosError ? (e.response?.data as { message?: string } | undefined)?.message : null) ?? fallback)

/** Статус бокса: через Home Assistant на сервере раз в 15 с, только пока страница открыта и вкладка видна */
export function useUgoosStatus() {
  return useQuery({ queryKey: ['ugoos-status'], queryFn: async () => (await api.get<UgoosStatus>('/ugoos/status')).data, refetchInterval: 15_000, retry: false })
}

/** Нажатие кнопки UGOOS: ключ через /api/ugoos/key — в отличие от ТВ Samsung тут нет запасной сцены на питание,
 *  бокс всегда управляется через Home Assistant (ADB) */
export function useUgoosPress() {
  const qc = useQueryClient()
  const busy = useRef(new Set<string>())
  return useCallback(
    async (_id: string, key: string) => {
      const repeat = isUgoosRepeatable(key)
      if (repeat && busy.current.has(key)) return // предыдущий повтор ещё в пути: не копим очередь
      if (repeat) busy.current.add(key)
      try {
        await api.post('/ugoos/key', { key })
      } catch (e) {
        if (!(e instanceof AxiosError && e.response?.status === 429)) toast.error(msg(e, 'Бокс не отвечает'))
        void qc.invalidateQueries({ queryKey: ['ugoos-status'] })
      } finally {
        busy.current.delete(key)
      }
    },
    [qc],
  )
}
