import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AxiosError } from 'axios'
import { Plus, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { moveItem } from '@/lib/layout-order'
import { bumpVolume } from '@/lib/receiver-remote'
import { runScene } from '@/lib/smarthome'
import { removeButton, stripView, uniRepeatable, UNI_COLUMNS, UNI_COLUMN_TITLE, upsertButton, type DeviceState, type UniButton, type UniButtonView, type UniColumn, type UniData } from '@/lib/universal-pad'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useReceiver } from '@/features/receiver/use-receiver'
import { useTvPress, useTvStatus } from '@/features/tv-remote/use-tv'
import { AddDialog, TileDialog } from './dialogs'
import { UniversalPad } from './universal-pad'

const errText = (e: unknown, fallback: string) => ((e instanceof AxiosError ? (e.response?.data as { message?: string } | undefined)?.message : null) ?? fallback)

/** Состав плиток с сервера (universal.remote.tv и universal.remote.receiver): каждый столбец сохраняется целиком */
function useUniversal() {
  const qc = useQueryClient()
  const key = ['universal-remote']
  const q = useQuery({ queryKey: key, queryFn: async () => (await api.get<UniData>('/universal/remote')).data, staleTime: 60_000 })
  const put = useMutation({
    mutationFn: async (v: { column: UniColumn; buttons: UniButton[] }) => (await api.put<UniData>(`/universal/remote/${v.column}`, { buttons: v.buttons })).data,
    onSuccess: (d) => qc.setQueryData(key, d),
    onError: (e) => toast.error(errText(e, 'Не удалось сохранить пульт')),
  })
  const reset = useMutation({
    mutationFn: async (column: UniColumn) => (await api.post<UniData>(`/universal/remote/${column}/reset`)).data,
    onSuccess: (d, column) => {
      qc.setQueryData(key, d)
      toast.success(`Набор кнопок «${UNI_COLUMN_TITLE[column]}» возвращён к начальному`)
    },
    onError: (e) => toast.error(errText(e, 'Не удалось сбросить')),
  })
  return { data: q.data, isError: q.isError, save: put.mutate, pending: put.isPending, reset: reset.mutate }
}

function SortableTile({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? 'z-30 opacity-80' : undefined} {...attributes} {...listeners}>
      {children}
    </div>
  )
}

type ColumnProps = {
  column: UniColumn
  data: UniData | undefined
  st: DeviceState
  pending: boolean
  onPress: (b: UniButtonView) => void
  onSave: (column: UniColumn, buttons: UniButton[]) => void
  onReset: (column: UniColumn) => void
}

/** Один столбец: свой переключатель «Изменить», своё добавление, перетаскивание и сброс */
function Column({ column, data, st, pending, onPress, onSave, onReset }: ColumnProps) {
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editTile, setEditTile] = useState<{ b: UniButton; isNew: boolean } | null>(null)
  const col = data?.columns?.[column]
  const buttons = col?.buttons ?? []
  const list = () => buttons.map(stripView)
  const max = data?.max ?? 48
  const sw = `universal-edit-${column}`

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const ids = buttons.map((b) => b.id)
    onSave(column, moveItem(list(), ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))))
  }
  const saveTile = (v: UniButton) => {
    onSave(column, upsertButton(list(), v))
    setEditTile(null)
  }

  const grid = (
    <UniversalPad
      buttons={buttons}
      st={st}
      editing={editing}
      onPress={onPress}
      onEdit={(b) => setEditTile({ b: stripView(b), isNew: false })}
      onRemove={(b) => onSave(column, removeButton(list(), b.id))}
      wrap={editing ? (b, node) => <SortableTile id={b.id}>{node}</SortableTile> : undefined}
    />
  )

  return (
    <section className='space-y-3 rounded-xl border p-3' aria-label={`Универсальный пульт: ${UNI_COLUMN_TITLE[column]}`} data-column={column}>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h2 className='text-sm font-medium'>{UNI_COLUMN_TITLE[column]}</h2>
        <div className='flex shrink-0 items-center gap-2'>
          {editing && (
            <>
              <Button type='button' size='sm' variant='outline' onClick={() => setAdding(true)} disabled={!data || buttons.length >= max}>
                <Plus /> Добавить кнопку
              </Button>
              <Button type='button' size='sm' variant='outline' onClick={() => onReset(column)} disabled={col?.isDefault}>
                <RotateCcw /> Сбросить
              </Button>
            </>
          )}
          <Label htmlFor={sw} className='text-sm'>
            Изменить
          </Label>
          <Switch id={sw} checked={editing} onCheckedChange={setEditing} disabled={!data} />
        </div>
      </div>

      {editing ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={buttons.map((b) => b.id)} strategy={rectSortingStrategy}>
            {grid}
          </SortableContext>
        </DndContext>
      ) : (
        grid
      )}

      {adding && data && (
        <AddDialog
          catalog={data.catalog}
          defaultSource={column}
          taken={buttons}
          onClose={() => setAdding(false)}
          onPick={(b) => {
            setAdding(false)
            setEditTile({ b, isNew: true })
          }}
        />
      )}
      {editTile && (
        <TileDialog b={editTile.b} title={editTile.isNew ? 'Новая кнопка' : `Кнопка «${editTile.b.label}»`} pending={pending} onSave={saveTile} onClose={() => setEditTile(null)} />
      )}
    </section>
  )
}

/** Вкладка «Универсальный»: два столбца частых кнопок — слева телевизор и сцены, справа ресивер */
export function UniversalTab() {
  const { data, save, pending, reset } = useUniversal()
  const { q: receiver, send, patch } = useReceiver()
  const tv = useTvStatus()
  const tvPress = useTvPress(tv.data)
  const st: DeviceState = { receiver: receiver.data, tv: tv.data }

  const press = (b: UniButtonView) => {
    if (!b.resolved) return
    if (b.source === 'receiver') {
      if (b.resolved === 'MVUP' || b.resolved === 'MVDOWN') patch((s) => bumpVolume(s, b.resolved as 'MVUP' | 'MVDOWN'))
      void send(b.resolved, { quiet: uniRepeatable(b) })
      return
    }
    if (b.source === 'tv') return void tvPress(b.id, b.resolved)
    void runScene((id) => api.post('/smarthome/ha/scene', { entity_id: id }), b.resolved, (e) => errText(e, 'Не удалось запустить сцену')).then((r) =>
      r.ok ? toast.success(`Сцена «${b.label}» запущена`) : toast.error(r.message),
    )
  }

  return (
    <div className='space-y-4'>
      <p className='text-xs text-muted-foreground'>
        Частые кнопки телевизора, сцен и ресивера. Команды те же, что на оригинальных пультах. Каждый столбец правится отдельно: «Изменить» → перетаскивание, «Добавить кнопку», «⋯» на плитке.
      </p>
      <div className='grid gap-6 md:grid-cols-2'>
        {UNI_COLUMNS.map((c) => (
          <Column key={c} column={c} data={data} st={st} pending={pending} onPress={press} onSave={(column, buttons) => save({ column, buttons })} onReset={reset} />
        ))}
      </div>
    </div>
  )
}
