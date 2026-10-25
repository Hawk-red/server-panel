import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { CmdResult, ReceiverFullState } from '@/lib/receiver-remote'

type ApiError = { message?: string; code?: string }
export const errInfo = (e: unknown) => {
  const ax = e instanceof AxiosError ? e : null
  const d = ax?.response?.data as ApiError | undefined
  return { status: ax?.response?.status ?? 0, message: d?.message ?? 'Не удалось связаться с ресивером', code: d?.code ?? (ax?.response ? '' : 'offline') }
}

/** Состояние ресивера и отправка команд (общий запрос ['receiver'] для вкладок «Ресивер», «Пульт ресивера» и «Универсальный») */
export function useReceiver() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['receiver'],
    queryFn: async () => (await api.get<ReceiverFullState>('/receiver')).data,
    refetchInterval: 10_000, // пока вкладка открыта (в фоне react-query не опрашивает)
    retry: false,
  })
  const [pending, setPending] = useState<string | null>(null)
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Полное состояние — через 1,5 с после серии кликов
  const scheduleRefresh = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current)
    refetchTimer.current = setTimeout(() => void qc.invalidateQueries({ queryKey: ['receiver'] }), 1500)
  }, [qc])
  useEffect(() => () => void (refetchTimer.current && clearTimeout(refetchTimer.current)), [])

  const patch = useCallback((fn: (s: ReceiverFullState) => ReceiverFullState) => qc.setQueryData<ReceiverFullState>(['receiver'], (s) => (s ? fn(s) : s)), [qc])

  /** quiet — частые команды (громкость, навигация): без блокировки кнопок и без тостов о частоте */
  const send = useCallback(
    async (command: string, opts: { quiet?: boolean } = {}): Promise<CmdResult | null> => {
      if (!opts.quiet) setPending(command)
      try {
        const r = (await api.post<CmdResult>('/receiver/command', { command })).data
        if (r.state) qc.setQueryData(['receiver'], r.state)
        else if (r.volume !== null) patch((s) => ({ ...s, volume: r.volume, volumeDb: r.volume! - 80 }))
        if (!r.accepted) toast.error(r.message ?? `Ресивер не принял команду ${command}`)
        if (opts.quiet) scheduleRefresh()
        return r
      } catch (e) {
        const i = errInfo(e)
        if (i.status !== 429) toast.error(i.message)
        void qc.invalidateQueries({ queryKey: ['receiver'] })
        return null
      } finally {
        if (!opts.quiet) setPending(null)
      }
    },
    [qc, patch, scheduleRefresh],
  )
  return { q, pending, send, patch }
}
