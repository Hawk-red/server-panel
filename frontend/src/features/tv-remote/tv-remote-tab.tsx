import { useState } from 'react'
import { ConfigureBar, CommandPicker } from '@/features/receiver/remote-tab'
import { useBindings } from '@/features/receiver/use-bindings'
import { TvPad } from './tv-pad'
import { useTvPress, useTvStatus } from './use-tv'

/** Вкладка «Пульт ТВ»: экранная копия AA59-00602A, режим «Настроить пульт», привязки на сервере (tv.remote) */
export function TvRemoteTab() {
  const status = useTvStatus()
  const st = status.data
  const press = useTvPress(st)
  const [configure, setConfigure] = useState(false)
  const [picking, setPicking] = useState<string | null>(null)
  const { cfg, isError, save } = useBindings('/tv')
  return (
    <div className='space-y-4'>
      <ConfigureBar configure={configure} onChange={setConfigure} disabled={!cfg} error={isError} />
      {st && !st.online && !configure && <p className='mx-auto max-w-[360px] text-center text-xs text-muted-foreground'>Телевизор не отвечает: кнопки серые, питание запускает сцену включения.</p>}
      <TvPad st={st} cfg={cfg} configure={configure} onPress={(id, k) => void press(id, k)} onPick={setPicking} />
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
