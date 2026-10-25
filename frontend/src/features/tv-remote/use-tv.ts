import { useCallback, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { runScene } from '@/lib/smarthome'
import { isTvRepeatable, powerVia, type TvStatus } from '@/lib/tv-pad'

const msg = (e: unknown, fallback: string) => ((e instanceof AxiosError ? (e.response?.data as { message?: string } | undefined)?.message : null) ?? fallback)

/** Статус ТВ: TCP-проверка на сервере раз в 15 с, только пока страница открыта и вкладка видна (react-query в фоне не опрашивает) */
export function useTvStatus() {
  return useQuery({ queryKey: ['tv-status'], queryFn: async () => (await api.get<TvStatus>('/tv/status')).data, refetchInterval: 15_000, retry: false })
}

/** Нажатие кнопки ТВ: ключ через /api/tv/key; питание выключенного ТВ — сцена из настроек (scene.tv_on) через существующий API сцен */
export function useTvPress(st: TvStatus | undefined) {
  const qc = useQueryClient()
  const busy = useRef(new Set<string>())
  return useCallback(
    async (_id: string, key: string) => {
      const repeat = isTvRepeatable(key)
      if (repeat && busy.current.has(key)) return // предыдущий повтор ещё в пути: не копим очередь
      if (key === 'KEY_POWER' && powerVia(st) === 'scene') {
        const r = await runScene((id) => api.post('/smarthome/ha/scene', { entity_id: id }), st?.sceneOn ?? 'scene.tv_on', (e) => msg(e, 'Не удалось запустить сцену'))
        if (r.ok) toast.success('Сцена включения ТВ запущена')
        else toast.error(r.message)
        return
      }
      if (repeat) busy.current.add(key)
      try {
        await api.post('/tv/key', { key })
      } catch (e) {
        if (!(e instanceof AxiosError && e.response?.status === 429)) toast.error(msg(e, 'Телевизор не отвечает'))
        void qc.invalidateQueries({ queryKey: ['tv-status'] })
      } finally {
        busy.current.delete(key)
      }
    },
    [st, qc],
  )
}
