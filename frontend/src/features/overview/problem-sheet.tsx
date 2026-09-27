import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight, CircleAlert, ClipboardCopy, Loader2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import type { Diagnostics, Problem } from '@/lib/types'
import { NoData } from '@/components/no-data'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

const SECTION: Record<Problem['kind'], string> = {
  unit: 'Система → Службы',
  disk: 'Система → Диски',
  smart: 'Система → Диски',
  temp: 'Система → Ресурсы',
  devices: 'Сеть и устройства',
  source: 'раздел источника',
}

// Боковая панель по проблеме: статус, последние 100 строк лога, переход в раздел, копирование для чата с Claude
export function ProblemSheet({ problem, onClose }: { problem: Problem | null; onClose: () => void }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['diagnostics', problem?.kind, problem?.ref],
    queryFn: async () => (await api.get<Diagnostics>('/diagnostics', { params: { kind: problem!.kind, ref: problem!.ref } })).data,
    enabled: Boolean(problem),
    staleTime: 10_000,
  })

  const copy = async () => {
    if (!data) return
    const ok = await copyText(data.copy)
    if (ok) toast.success('Скопировано — можно вставить в чат с Claude')
    else toast.error('Браузер не дал скопировать — выделите текст вручную')
  }

  return (
    <Sheet open={Boolean(problem)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className='w-full gap-0 sm:max-w-2xl'>
        {problem && (
          <>
            <SheetHeader className='border-b'>
              <SheetTitle className='flex items-start gap-2 pe-6'>
                {problem.level === 'error' ? (
                  <CircleAlert className='mt-0.5 size-5 shrink-0 text-danger-foreground' aria-label='ошибка' />
                ) : (
                  <TriangleAlert className='mt-0.5 size-5 shrink-0 text-warn-foreground' aria-label='предупреждение' />
                )}
                {problem.text}
              </SheetTitle>
              <SheetDescription>{problem.level === 'error' ? 'Ошибка' : 'Предупреждение'} · диагностика на момент открытия</SheetDescription>
              <div className='flex flex-wrap gap-2 pt-2'>
                <Button size='sm' onClick={copy} disabled={!data}>
                  <ClipboardCopy /> Скопировать для диагностики
                </Button>
                <Button size='sm' variant='outline' asChild>
                  <Link to={problem.link} onClick={onClose}>
                    <ArrowRight /> {SECTION[problem.kind]}
                  </Link>
                </Button>
              </div>
            </SheetHeader>
            <div className='flex-1 space-y-4 overflow-y-auto p-4 text-sm'>
              {isPending ? (
                <p className='flex items-center gap-2 text-muted-foreground'>
                  <Loader2 className='size-4 animate-spin' /> Собираю статус и лог…
                </p>
              ) : isError || !data ? (
                <NoData reason='диагностика не получена' />
              ) : (
                <>
                  <section>
                    <h3 className='mb-1 font-medium'>Статус</h3>
                    <pre className='overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap'>{data.status.trim() || '—'}</pre>
                  </section>
                  {data.logSource && (
                    <section>
                      <h3 className='mb-1 font-medium'>
                        Лог: последние {data.lines.length} строк <span className='font-mono text-xs font-normal text-address'>{data.logSource}</span>
                      </h3>
                      {data.lines.length === 0 ? (
                        <p className='text-muted-foreground'>Пусто.</p>
                      ) : (
                        <pre className='max-h-[50svh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap'>{data.lines.join('\n')}</pre>
                      )}
                    </section>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
