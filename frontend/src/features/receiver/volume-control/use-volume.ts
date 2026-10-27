// Данные регулятора громкости: скин с сервера (receiver.volumeSkin) и отправка абсолютной громкости
// (POST /receiver/volume, один запрос в полёте, только последнее значение). Все защиты — на сервере.
import { useCallback, useRef } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { ReceiverFullState } from '@/lib/receiver-remote'
import { createLatestSender, parseVolumeSkin, type LatestSender, type VolumeSkin } from '@/lib/volume-drag'
import { errInfo } from '../use-receiver'

export type VolumeReply = { from: number; volume: number; target: number; clamped: boolean; maxVolume: number }
type SkinReply = { skin: string; skins: string[] }

const SKIN_KEY = ['receiver-volume-skin']
const CHECK_AFTER_MS = 1200 // после протяжки сверяем состояние с реальным
const TOAST_GAP_MS = 3000 // об ошибках связи — не чаще раза в 3 с (при протяжке запросов много)

/** Выбранный скин регулятора (общий для всех устройств) */
export function useVolumeSkin() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: SKIN_KEY, queryFn: async () => (await api.get<SkinReply>('/receiver/volume/skin')).data, staleTime: 300_000 })
  const put = useMutation({
    mutationFn: async (skin: VolumeSkin) => (await api.put<SkinReply>('/receiver/volume/skin', { skin })).data,
    onMutate: (skin) => void qc.setQueryData<SkinReply>(SKIN_KEY, (old) => (old ? { ...old, skin } : old)),
    onSuccess: (d) => void qc.setQueryData(SKIN_KEY, d),
    onError: () => {
      toast.error('Не удалось сохранить вид регулятора')
      void qc.invalidateQueries({ queryKey: SKIN_KEY })
    },
  })
  return { skin: parseVolumeSkin(q.data?.skin), setSkin: put.mutate }
}

/** Отправщик громкости: пока ответ не пришёл, новое значение заменяет отложенное; финальное — со сверкой состояния */
function makeVolumeSender(qc: QueryClient): LatestSender {
  let check: ReturnType<typeof setTimeout> | null = null
  let toastAt = 0
  return createLatestSender(async (value, final) => {
    try {
      const r = (await api.post<VolumeReply>('/receiver/volume', { value })).data
      qc.setQueryData<ReceiverFullState>(['receiver'], (s) => (s ? { ...s, volume: r.volume, volumeDb: r.volume - 80 } : s))
      if (final) {
        if (check) clearTimeout(check)
        check = setTimeout(() => void qc.invalidateQueries({ queryKey: ['receiver'] }), CHECK_AFTER_MS)
      }
    } catch (e) {
      const i = errInfo(e)
      if (i.status !== 429 && Date.now() - toastAt > TOAST_GAP_MS) {
        toastAt = Date.now()
        toast.error(i.message)
      }
      void qc.invalidateQueries({ queryKey: ['receiver'] })
    }
  })
}

export function useVolumeSend() {
  const qc = useQueryClient()
  const box = useRef<LatestSender | null>(null)
  if (box.current == null) box.current = makeVolumeSender(qc)
  return useCallback((value: number, final: boolean) => box.current?.push(value, final), [])
}

/** Почему регулятор серый */
export function offReason(st: ReceiverFullState | undefined, error: boolean): string | null {
  if (error || !st) return 'Нет связи с ресивером'
  if (st.power !== 'ON') return 'Ресивер выключен — громкость недоступна'
  if (st.volume === null) return 'Ресивер пока не сообщил громкость'
  return null
}
