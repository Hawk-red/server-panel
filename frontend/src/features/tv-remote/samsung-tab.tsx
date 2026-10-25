import { cn } from '@/lib/utils'
import { tvPairLabel, tvStatusLabel } from '@/lib/tv-pad'
import { TvRemoteTab } from './tv-remote-tab'
import { useTvStatus } from './use-tv'

/** Вкладка «Samsung»: статус телевизора и его оригинальный пульт AA59-00602A (кнопки и «Настроить пульт» — прежние) */
export function SamsungTab() {
  const q = useTvStatus()
  const st = q.data
  const conn = tvStatusLabel(st, q.isError)
  const pairing = tvPairLabel(st)
  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2 text-sm' role='status'>
        <span>Samsung 55″</span>
        <span className='text-muted-foreground' aria-hidden>
          ·
        </span>
        <span className='inline-flex items-center gap-1.5'>
          <span className={cn('inline-block size-2 rounded-full', conn.cls)} aria-hidden /> {conn.label}
        </span>
        {pairing && (
          <>
            <span className='text-muted-foreground' aria-hidden>
              ·
            </span>
            <span className={pairing.cls}>{pairing.label}</span>
          </>
        )}
        <span className='text-xs text-muted-foreground'>{st?.host ?? '192.168.31.181'}</span>
      </div>
      <TvRemoteTab />
    </div>
  )
}
