import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { SidebarMenuButton } from '@/components/ui/sidebar'
import { GitJobOverlay } from './job-overlay'

type Candidate = { hash: string; subject: string; protected: boolean } | null

// Кнопка в сайдбаре: откат последней правки. Подтверждение показывает заголовок коммита, который откатится.
export function RevertLastButton() {
  const [open, setOpen] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const cand = useQuery({
    queryKey: ['git-candidate'],
    queryFn: async () => (await api.get<Candidate>('/panel-changes/revert-candidate')).data,
    enabled: open,
    retry: false,
  })
  const c = cand.data
  const act = useMutation({
    mutationFn: async (hash: string) => (await api.post<{ id: string }>('/panel-changes/revert-last', { hash })).data,
    onSuccess: (r) => {
      setOpen(false)
      setJobId(r.id)
    },
    onError: (e) => {
      setOpen(false)
      toast.error((e instanceof AxiosError && e.response?.data?.message) || 'не удалось откатить')
    },
  })

  return (
    <>
      <SidebarMenuButton tooltip='Откатить последнюю правку' className='text-warn-foreground hover:bg-warn/10 hover:text-warn-foreground' onClick={() => setOpen(true)}>
        <Undo2 />
        <span>Откатить последнюю правку</span>
      </SidebarMenuButton>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => !act.isPending && setOpen(o)}
        title='Откатить последнюю правку?'
        desc={
          cand.isPending ? (
            'Загрузка…'
          ) : !c ? (
            'Откатывать нечего: активных правок нет.'
          ) : (
            <div className='space-y-2 text-sm'>
              <p>Будет откатён коммит:</p>
              <p className='font-medium break-words'>«{c.subject}»</p>
              <p className='font-mono text-xs text-address'>{c.hash.slice(0, 7)}</p>
              <p>Будет создан новый коммит, отменяющий его изменения. Панель пересоберётся и перезапустится, страница вернётся сама.</p>
              {c.protected && <p className='text-danger-foreground'>Коммит меняет права sudo или утилиту панели — откатывается только вручную.</p>}
            </div>
          )
        }
        confirmText='Откатить'
        disabled={!c || c.protected}
        isLoading={act.isPending}
        handleConfirm={() => c && act.mutate(c.hash)}
      />
      {jobId && <GitJobOverlay jobId={jobId} onClose={() => setJobId(null)} />}
    </>
  )
}
