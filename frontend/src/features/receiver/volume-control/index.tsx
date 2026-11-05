// Блок «Громкость» с регулятором-протяжкой: состояние берётся из общего запроса ['receiver'], абсолютная громкость уходит
// на POST /receiver/volume (потолок, ограничение роста и лимиты держит сервер), скин хранится в настройке receiver.volumeSkin.
import { useState } from 'react'
import { knobDisabled, volumeUnits } from '@/lib/volume-drag'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useReceiver } from '../use-receiver'
import { CapsuleExpanded } from './capsule-expanded'
import { offReason, useVolumeSend, useVolumeSkin } from './use-volume'
import { VolumeKnob } from './volume-knob'
import { cn } from '@/lib/utils'

/** Регулятор громкости: полноразмерный (вкладка «Marantz»), компактный (столбец «Marantz»), полноэкранный (вкладка «Volume») */
export function VolumeControl({ compact = false, fullScreen = false }: { compact?: boolean; fullScreen?: boolean }) {
  const { q, send } = useReceiver()
  const st = q.data
  const { skin, setSkin } = useVolumeSkin()
  const push = useVolumeSend()
  const disabled = knobDisabled(st) || q.isError
  // Разворот на весь экран — только у вида «Капсула», тапом по регулятору (без протяжки)
  const [expanded, setExpanded] = useState(false)
  // Как «Изменить» у карточек UNIVERSAL/MARANTZ — здесь прячет единственное, что тут можно менять: вид регулятора
  // (Крутилка/Пульт/Капсула). В compact/fullScreen (дашборд-капсула, телефонный HUD) переключатель вида виден всегда —
  // там нет места/смысла для отдельного тумблера «Изменить»
  const [editing, setEditing] = useState(false)
  const showSkinSwitch = compact || fullScreen || editing
  // Только два состояния индикатора: «подключаюсь» и «ошибка» тоже считаются офлайн — отдельно их не различаем
  const online = !q.isError && st != null
  const connection = online ? { label: 'онлайн', cls: 'bg-emerald-600' } : { label: 'офлайн', cls: 'bg-red-600' }
  // fill — только у карточки «Громкость» (не compact, не fullScreen): там у капсулы есть явная высота
  // родителя (обёртка h-72 ниже), и она растягивается на неё целиком, а не на свои фиксированные h-48/h-64
  const fillCapsule = !compact && !fullScreen
  const knob = (
    <VolumeKnob
      value={st?.volume ?? null}
      max={st?.maxVolume ?? 60}
      mute={st?.mute === true}
      disabled={disabled}
      reason={offReason(st, q.isError)}
      skin={skin}
      onSkin={showSkinSwitch ? (s) => setSkin(s) : undefined}
      onSend={push}
      onMute={() => void send(st?.mute === true ? 'MUOFF' : 'MUON')}
      onExpand={skin === 'capsule' && !disabled ? () => setExpanded(true) : undefined}
      compact={compact}
      fullScreen={fullScreen}
      fill={fillCapsule}
    />
  )
  if (compact) return <div data-volume-block='compact'>{knob}</div>
  if (fullScreen) return (
    <div className='flex flex-col h-full min-h-0' style={{ touchAction: 'manipulation' }}>
      <div className='flex items-center justify-between gap-2 px-3 py-2 border-b'>
        <h2 className='text-sm font-medium'>Громкость</h2>
        <span className='inline-flex items-center gap-1.5'>
          <span className={cn('inline-block size-2 rounded-full', connection.cls)} aria-hidden /> {connection.label}
        </span>
      </div>
      <div className='flex-1 min-h-0 flex items-center justify-center p-4'>
        {knob}
      </div>
    </div>
  )
  // Высота — по содержимому регулятора: фиксированных «тёмных полей» вокруг него больше нет
  return (
    <>
      {/* На мобильном карточка — на всю ширину грида (как соседние TV/Marantz): есть место под число/статус/
          переключатель по бокам капсулы. От md: и выше карточка сама сужается до пилюли (max-w-36), тогда
          эти поля уже не нужны вокруг — но в коде они остаются (просто CardContent там узкий и ряды сжимаются).
          Капсулу держит в узких рамках не Card, а свой собственный max-w-36 на обёртке {knob} — иначе на
          мобильном широкая карточка растянула бы саму пилюлю на всю ширину вместе с собой */}
      <Card data-volume-block='full' className='mx-auto w-full gap-3 py-4 md:max-w-36'>
        <CardContent className='flex min-w-0 flex-col gap-2 px-1'>
          <div className='flex items-center justify-end gap-1 px-1 text-[11px] text-muted-foreground'>
            <h2 className='sr-only'>Громкость</h2>
            {/* статус связи с ресивером — та же переменная connection, что и у fullScreen-вида, только два состояния: онлайн/офлайн */}
            <span className={cn('inline-block size-1.5 rounded-full', connection.cls)} aria-hidden />
            {connection.label}
          </div>
          {/* число громкости слева от капсулы — постоянно видимое (раньше было только во временном бейдже капсулы во время протяжки).
              w-6/gap-2 — минимум, который эта колонка отъедает у капсулы и на узкой (md:) карточке тоже: саму капсулу
              держит в рамках не Card, а max-w-36 на обёртке {knob} — иначе на мобильном широкая карточка растянула бы пилюлю.
              h-72 на этой же обёртке — та самая «явная высота родителя»: капсула (fill, см. VolumeKnobProps.fill) заполняет
              её целиком, без зазора сверху/снизу, вместо собственных фиксированных h-48/h-64, которые жили сами по себе */}
          <div className='flex min-w-0 items-center justify-center gap-2'>
            <span className='w-6 shrink-0 text-right text-lg font-bold tabular-nums' aria-live='polite'>{volumeUnits(st?.volume ?? null)}</span>
            <div className='mx-auto h-72 w-full max-w-36 min-w-0'>{knob}</div>
          </div>
          <div className='flex items-center justify-end gap-2 px-1 pt-1'>
            <Label htmlFor='volume-edit' className='text-sm'>Изменить</Label>
            <Switch id='volume-edit' checked={editing} onCheckedChange={setEditing} />
          </div>
        </CardContent>
      </Card>
      {expanded && st && (
        <CapsuleExpanded value={st.volume ?? 0} max={st.maxVolume ?? 60} disabled={disabled} onSend={push} onClose={() => setExpanded(false)} />
      )}
    </>
  )
}
