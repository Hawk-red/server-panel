import { useState } from 'react'
import { cn } from '@/lib/utils'
import { ugoosStatusLabel } from '@/lib/ugoos-pad'
import { CommandPicker, ConfigureBar } from '@/features/receiver/remote-tab'
import { useBindings } from '@/features/receiver/use-bindings'
import { UgoosPad } from './ugoos-pad'
import { useUgoosPress, useUgoosStatus } from './use-ugoos'

/** Вкладка «UGOOS»: статус бокса по ADB и его экранный пульт (привязки — ugoos.remote) */
export function UgoosTab() {
  const q = useUgoosStatus()
  const st = q.data
  const press = useUgoosPress()
  const [configure, setConfigure] = useState(false)
  const [picking, setPicking] = useState<string | null>(null)
  const { cfg, isError, save } = useBindings('/ugoos')
  const conn = ugoosStatusLabel(st, q.isError)
  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2 text-sm' role='status'>
        <span>UGOOS SK1</span>
        <span className='text-muted-foreground' aria-hidden>
          ·
        </span>
        <span className='inline-flex items-center gap-1.5'>
          <span className={cn('inline-block size-2 rounded-full', conn.cls)} aria-hidden /> {conn.label}
        </span>
      </div>
      <ConfigureBar configure={configure} onChange={setConfigure} disabled={!cfg} error={isError} />
      {st && !configure && !st.online && <p className='mx-auto max-w-[300px] text-center text-xs text-muted-foreground'>Бокс не отвечает по ADB: нажатия всё равно отправляются, но могут не дойти. Проверьте, что бокс включён и в сети.</p>}
      <UgoosPad st={st} cfg={cfg} configure={configure} onPress={(id, k) => void press(id, k)} onPick={setPicking} />
      {cfg && (
        <CommandPicker
          button={picking}
          cfg={cfg}
          onClose={() => setPicking(null)}
          onChoose={(v) => {
            const button = picking
            setPicking(null)
            if (button) save({ button, command: v })
          }}
        />
      )}
    </div>
  )
}
