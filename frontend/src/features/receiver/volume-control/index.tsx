// Блок «Громкость» с регулятором-протяжкой: состояние берётся из общего запроса ['receiver'], абсолютная громкость уходит
// на POST /receiver/volume (потолок, ограничение роста и лимиты держит сервер), скин хранится в настройке receiver.volumeSkin.
import { useState } from 'react'
import { knobDisabled } from '@/lib/volume-drag'
import { Card, CardContent } from '@/components/ui/card'
import { useReceiver } from '../use-receiver'
import { CapsuleExpanded } from './capsule-expanded'
import { offReason, useVolumeSend, useVolumeSkin } from './use-volume'
import { VolumeKnob } from './volume-knob'

/** Регулятор громкости: полноразмерный (вкладка «Marantz») и компактный (столбец «Marantz» универсального пульта) */
export function VolumeControl({ compact = false }: { compact?: boolean }) {
  const { q, send } = useReceiver()
  const st = q.data
  const { skin, setSkin } = useVolumeSkin()
  const push = useVolumeSend()
  const disabled = knobDisabled(st) || q.isError
  // Разворот на весь экран — только у вида «Капсула», тапом по регулятору (без протяжки)
  const [expanded, setExpanded] = useState(false)
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
      onExpand={skin === 'capsule' && !disabled ? () => setExpanded(true) : undefined}
      compact={compact}
    />
  )
  // Высота — по содержимому регулятора: фиксированных «тёмных полей» вокруг него больше нет
  return (
    <>
      {compact ? (
        <div data-volume-block='compact'>{knob}</div>
      ) : (
        <Card data-volume-block='full' className='gap-3 py-4'>
          <CardContent className='flex min-w-0 flex-col gap-2'>
            <div className='flex items-baseline justify-between gap-2'>
              <h2 className='text-sm font-medium'>Громкость</h2>
              <span className='text-xs text-muted-foreground'>протяните вверх или вниз</span>
            </div>
            {knob}
          </CardContent>
        </Card>
      )}
      {expanded && st && (
        <CapsuleExpanded value={st.volume ?? 0} max={st.maxVolume ?? 60} disabled={disabled} onSend={push} onClose={() => setExpanded(false)} />
      )}
    </>
  )
}
