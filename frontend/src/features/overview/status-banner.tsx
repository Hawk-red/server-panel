import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react'
import type { Problem } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Value } from '@/components/value'
import { Button } from '@/components/ui/button'

type Tone = 'ok' | 'warn' | 'error' | 'unknown'

const BOX: Record<Tone, string> = {
  ok: 'border-ok/30 bg-ok/10',
  warn: 'border-warn/40 bg-warn/10',
  error: 'border-danger/40 bg-danger/10',
  unknown: 'border-border bg-muted/40',
}
const ICON: Record<Tone, string> = { ok: 'text-ok-foreground', warn: 'text-warn-foreground', error: 'text-danger-foreground', unknown: 'text-muted-foreground' }

// «1 проблема», «2 проблемы», «5 проблем»
function problemsWord(n: number) {
  const a = n % 100
  const b = a % 10
  const word = a > 10 && a < 20 ? 'проблем' : b === 1 ? 'проблема' : b >= 2 && b <= 4 ? 'проблемы' : 'проблем'
  return `${n} ${word}`
}

// Полоса состояния сверху: одна фраза «всё в порядке» или «N проблем». Единственное место аптайма и версии панели.
export function StatusBanner({
  loading,
  problems,
  uptimeSec,
  panelVersion,
  connection,
  onShowProblems,
}: {
  loading: boolean
  problems: Problem[]
  uptimeSec?: number | null
  panelVersion?: string
  connection?: ReactNode
  onShowProblems: () => void
}) {
  const n = problems.length
  const tone: Tone = loading ? 'unknown' : n === 0 ? 'ok' : problems.some((p) => p.level === 'error') ? 'error' : 'warn'
  const Icon = tone === 'ok' ? CircleCheck : tone === 'error' ? CircleAlert : tone === 'warn' ? TriangleAlert : CircleCheck
  const title = loading ? 'Загрузка…' : n === 0 ? 'Всё в порядке' : problemsWord(n)
  return (
    <div role='status' className={cn('flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3', BOX[tone])}>
      <div className='flex min-w-0 items-center gap-3'>
        <Icon className={cn('size-6 shrink-0', ICON[tone])} aria-hidden='true' />
        <div className='min-w-0'>
          <div className='font-semibold'>{title}</div>
          <div className='text-xs text-muted-foreground'>
            {uptimeSec != null && (
              <>
                сервер работает <Value kind='duration' value={uptimeSec} />
              </>
            )}
            {panelVersion && <> · панель v{panelVersion}</>}
            {connection && <> · {connection}</>}
          </div>
        </div>
      </div>
      {n > 0 && (
        <Button size='sm' variant='outline' onClick={onShowProblems}>
          Смотреть проблемы
        </Button>
      )}
    </div>
  )
}
