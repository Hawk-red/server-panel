import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'

export type GitJob = { id: string; action: string; target: string; status: 'idle' | 'queued' | 'running' | 'ok' | 'conflict' | 'failed' | 'error'; message: string; log: string[]; ts: number }

const FINAL = ['ok', 'conflict', 'failed', 'error']

// Оверлей ожидания правки: опрашивает состояние задачи (не только доступность панели).
// Пока задача идёт или панель перезапускается — ждём. Успех — страница перезагружается, когда панель снова отвечает.
// Конфликт или ошибка — показываем причину и кнопку «Закрыть» (панель не перезапускалась, дерево не тронуто).
export function GitJobOverlay({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const job = useQuery({
    queryKey: ['git-job'],
    queryFn: async () => (await api.get<GitJob>('/panel-changes/job')).data,
    refetchInterval: 1500,
    retry: false,
  })
  const j = job.data
  const mine = j?.id === jobId
  const final = mine && FINAL.includes(j.status)
  const wentDown = useRef(false)
  useEffect(() => {
    if (job.isError) wentDown.current = true
  }, [job.isError, job.errorUpdatedAt])
  useEffect(() => {
    if (!final || j?.status !== 'ok') return
    // Панель перезапускается уже после записи «ok»: перезагружаем, когда она вернулась (или через 8 с — запасной вариант)
    if (wentDown.current) window.location.reload()
    const t = setTimeout(() => window.location.reload(), 8000)
    return () => clearTimeout(t)
  }, [final, j?.status, job.dataUpdatedAt])

  return createPortal(
    <div className='fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-background/95 p-6 text-center'>
      {!final && (
        <>
          <Loader2 className='size-10 animate-spin text-info' aria-hidden />
          <div className='text-lg font-semibold'>Правка панели</div>
          <p className='max-w-md text-sm text-muted-foreground'>{mine ? j.message : 'Задача ставится в очередь…'}</p>
          <p className='text-xs text-muted-foreground'>{job.isError ? 'панель перезапускается, жду её…' : 'пересборка занимает 1–2 минуты'}</p>
        </>
      )}
      {final && j.status === 'ok' && (
        <>
          <CircleCheck className='size-10 text-ok-foreground' aria-hidden />
          <div className='text-lg font-semibold'>Готово</div>
          <p className='max-w-md text-sm text-muted-foreground'>{j.message}</p>
        </>
      )}
      {final && j.status !== 'ok' && (
        <div className='w-full max-w-xl space-y-3'>
          <CircleAlert className='mx-auto size-10 text-danger-foreground' aria-hidden />
          <div className='text-lg font-semibold'>{j.status === 'conflict' ? 'Откат не выполнен' : 'Правка не применена'}</div>
          <p className='text-sm text-muted-foreground'>{j.message}</p>
          {j.log.length > 0 && (
            <details className='text-left text-xs'>
              <summary className='cursor-pointer text-muted-foreground'>Вывод</summary>
              <pre className='mt-1 max-h-60 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap'>{j.log.join('\n')}</pre>
            </details>
          )}
          <Button onClick={onClose}>Закрыть</Button>
        </div>
      )}
    </div>,
    document.body
  )
}
