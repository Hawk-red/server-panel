import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { RemoteConfig } from '@/lib/receiver-pad'

const errText = (e: unknown) => ((e instanceof AxiosError ? (e.response?.data as { message?: string } | undefined)?.message : null) ?? 'Не удалось сохранить')

/** Привязки кнопок пульта с сервера и их сохранение (общее для пультов ресивера и ТВ): path — /receiver или /tv */
export function useBindings(path: string) {
  const qc = useQueryClient()
  const key = ['remote-bindings', path]
  const q = useQuery({ queryKey: key, queryFn: async () => (await api.get<RemoteConfig>(`${path}/remote`)).data, staleTime: 60_000 })
  const save = useMutation({
    mutationFn: async (v: { button: string; command: string | null }) => (await api.put<Pick<RemoteConfig, 'defaults' | 'bindings'>>(`${path}/remote/${v.button}`, { command: v.command })).data,
    onSuccess: (d) => qc.setQueryData<RemoteConfig>(key, (old) => (old ? { ...old, ...d } : old)),
    onError: (e) => toast.error(errText(e)),
  })
  return { cfg: q.data, isError: q.isError, save: save.mutate }
}

