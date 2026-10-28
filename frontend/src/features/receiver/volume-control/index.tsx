// Блок «Громкость» с регулятором-протяжкой: состояние берётся из общего запроса ['receiver'], абсолютная громкость уходит
// на POST /receiver/volume (потолок, ограничение роста и лимиты держит сервер), скин хранится в настройке receiver.volumeSkin.
import { knobDisabled } from '@/lib/volume-drag'
import { Card, CardContent } from '@/components/ui/card'
import { useReceiver } from '../use-receiver'
import { offReason, useVolumeSend, useVolumeSkin } from './use-volume'
import { VolumeKnob } from './volume-knob'

/** Регулятор громкости: полноразмерный (вкладка «Marantz») и компактный (столбец «Marantz» универсального пульта) */
export function VolumeControl({ compact = false }: { compact?: boolean }) {
  const { q, send } = useReceiver()
  const st = q.data
  const { skin, setSkin } = useVolumeSkin()
  const push = useVolumeSend()
  const disabled = knobDisabled(st) || q.isError
  const knob = (
    <VolumeKnob
      value={st?.volume ?? null}
      max={st?.maxVolume ?? 60}
      mute={st?.mute === true}
      disabled={disabled}
      reason={offReason(st, q.isError)}
      skin={skin}
      onSkin={(s) => setSkin(s)}
      onSend={push}
      onMute={() => void send(st?.mute === true ? 'MUOFF' : 'MUON')}
      compact={compact}
    />
  )
  // Высота — по содержимому регулятора: фиксированных «тёмных полей» вокруг него больше нет
  if (compact)
    return <div data-volume-block='compact'>{knob}</div>
  return (
    <Card data-volume-block='full' className='gap-3 py-4'>
      <CardContent className='flex min-w-0 flex-col gap-2'>
        <div className='flex items-baseline justify-between gap-2'>
          <h2 className='text-sm font-medium'>Громкость</h2>
          <span className='text-xs text-muted-foreground'>протяните вверх или вниз</span>
        </div>
        {knob}
      </CardContent>
    </Card>
  )
}
