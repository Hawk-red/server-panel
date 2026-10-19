import { AxiosError } from 'axios'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type ReceiverState = {
  power: 'ON' | 'STANDBY' | null
  dynEq: string | null
  dynVol: string | null
  refLev: string | null
  tone: string | null
  multEq: string | null
}
type Key = 'dynEq' | 'dynVol' | 'refLev' | 'tone'

// Допустимые значения совпадают с белым списком на сервере (services/receiver.ts)
const CONTROLS: {
  key: Key
  title: string
  options: { value: string; label: string }[]
}[] = [
  {
    key: 'dynEq',
    title: 'Dynamic EQ',
    options: [
      { value: 'ON', label: 'Вкл' },
      { value: 'OFF', label: 'Выкл' },
    ],
  },
  {
    key: 'dynVol',
    title: 'Dynamic Volume',
    options: [
      { value: 'OFF', label: 'Выкл' },
      { value: 'LIT', label: 'Лёгкий' },
      { value: 'MED', label: 'Средний' },
      { value: 'HEV', label: 'Сильный' },
    ],
  },
  {
    key: 'refLev',
    title: 'Reference Level',
    options: ['0', '5', '10', '15'].map((v) => ({
      value: v,
      label: `${v} дБ`,
    })),
  },
  {
    key: 'tone',
    title: 'Tone Defeat',
    options: [
      { value: 'ON', label: 'Вкл' },
      { value: 'OFF', label: 'Выкл' },
    ],
  },
]

const errText = (e: unknown) =>
  (e instanceof AxiosError
    ? (e.response?.data as { message?: string } | undefined)?.message
    : null) ?? 'Не удалось связаться с ресивером'

export function ReceiverControls({ online }: { online: boolean }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['receiver'],
    queryFn: async () => (await api.get<ReceiverState>('/receiver')).data,
    enabled: online,
    refetchInterval: 15_000,
    retry: false,
  })
  const set = useMutation({
    mutationFn: async ({ key, value }: { key: Key; value: string }) =>
      (await api.post<ReceiverState>(`/receiver/${key}`, { value })).data,
    onSuccess: (state) => qc.setQueryData(['receiver'], state),
    onError: (e) => {
      toast.error(errText(e))
      qc.invalidateQueries({ queryKey: ['receiver'] })
    },
  })

  if (!online) return null
  const st = q.data
  const busy = set.isPending
  return (
    <div className='space-y-2'>
      <div className='text-xs font-medium'>Звук</div>
      {q.isError && (
        <p className='text-xs text-destructive'>{errText(q.error)}</p>
      )}
      {st?.power === 'STANDBY' && (
        <p className='text-xs text-muted-foreground'>
          Ресивер выключен — настройки недоступны.
        </p>
      )}
      {!st && !q.isError && (
        <p className='text-xs text-muted-foreground'>
          Читаю состояние ресивера…
        </p>
      )}
      {st?.power === 'ON' &&
        CONTROLS.map((c) => (
          <div key={c.key} className='flex flex-wrap items-center gap-2'>
            <span className='w-32 text-xs text-muted-foreground'>
              {c.title}
            </span>
            <div className='flex flex-wrap gap-1'>
              {c.options.map((o) => (
                <Button
                  key={o.value}
                  size='sm'
                  variant={st[c.key] === o.value ? 'default' : 'outline'}
                  className={cn('h-7 px-2 text-xs')}
                  disabled={busy}
                  aria-pressed={st[c.key] === o.value}
                  onClick={() =>
                    st[c.key] !== o.value &&
                    set.mutate({ key: c.key, value: o.value })
                  }
                >
                  {o.label}
                </Button>
              ))}
            </div>
            {st[c.key] === null && (
              <span className='text-xs text-muted-foreground'>нет данных</span>
            )}
          </div>
        ))}
      {st?.power === 'ON' && st.multEq && (
        <p className='text-xs text-muted-foreground'>
          MultEQ: {st.multEq} (меняется по ссылке ниже)
        </p>
      )}
    </div>
  )
}
