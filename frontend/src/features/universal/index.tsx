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
import { removeButton, stripView, uniRepeatable, upsertButton, type UniButton, type UniButtonView, type UniData } from '@/lib/universal-pad'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useReceiver } from '@/features/receiver/use-receiver'
import { useTvPress, useTvStatus } from '@/features/tv-remote/use-tv'
import { AddDialog, TileDialog } from './dialogs'
import { UniversalPad } from './universal-pad'

const errText = (e: unknown, fallback: string) => ((e instanceof AxiosError ? (e.response?.data as { message?: string } | undefined)?.message : null) ?? fallback)

/** Состав плиток с сервера (universal.remote) и его изменение: весь список сохраняется целиком */
function useUniversal() {
  const qc = useQueryClient()
  const key = ['universal-remote']
  const q = useQuery({ queryKey: key, queryFn: async () => (await api.get<UniData>('/universal/remote')).data, staleTime: 60_000 })
  const put = useMutation({
    mutationFn: async (buttons: UniButton[]) => (await api.put<UniData>('/universal/remote', { buttons })).data,
    onSuccess: (d) => qc.setQueryData(key, d),
    onError: (e) => toast.error(errText(e, 'Не удалось сохранить пульт')),
  })
  const reset = useMutation({
    mutationFn: async () => (await api.post<UniData>('/universal/remote/reset')).data,
    onSuccess: (d) => {
      qc.setQueryData(key, d)
      toast.success('Набор кнопок возвращён к начальному')
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

/** Вкладка «Универсальный»: частые кнопки ресивера, телевизора и сцен одной сеткой */
export function UniversalTab() {
  const { data, save, pending, reset } = useUniversal()
  const { q: receiver, send, patch } = useReceiver()
  const tv = useTvStatus()
  const tvPress = useTvPress(tv.data)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editTile, setEditTile] = useState<{ b: UniButton; isNew: boolean } | null>(null)

  const buttons = data?.buttons ?? []
  const st = { receiver: receiver.data, tv: tv.data }
  const list = () => buttons.map(stripView)

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const ids = buttons.map((b) => b.id)
    save(moveItem(list(), ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))))
  }

  const saveTile = (v: UniButton) => {
    save(upsertButton(list(), v))
    setEditTile(null)
  }
  const remove = (b: UniButtonView) => save(removeButton(list(), b.id))

  const grid = (
    <UniversalPad
      buttons={buttons}
      st={st}
      editing={editing}
      onPress={press}
      onEdit={(b) => setEditTile({ b: stripView(b), isNew: false })}
      onRemove={remove}
      wrap={editing ? (b, node) => <SortableTile id={b.id}>{node}</SortableTile> : undefined}
    />
  )

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <p className='text-xs text-muted-foreground'>
          {editing ? 'Перетащите плитки, чтобы поменять порядок. «⋯» на плитке — подпись, цвет, значок, удалить.' : 'Частые кнопки ресивера, телевизора и сцен. Команды те же, что на оригинальных пультах.'}
        </p>
        <div className='flex shrink-0 items-center gap-2'>
          {editing && (
            <>
              <Button type='button' size='sm' variant='outline' onClick={() => setAdding(true)} disabled={!data || buttons.length >= (data?.max ?? 48)}>
                <Plus /> Добавить кнопку
              </Button>
              <Button type='button' size='sm' variant='outline' onClick={() => reset()} disabled={data?.isDefault}>
                <RotateCcw /> Сбросить по умолчанию
              </Button>
            </>
          )}
          <Label htmlFor='universal-edit' className='text-sm'>
            Изменить
          </Label>
          <Switch id='universal-edit' checked={editing} onCheckedChange={setEditing} disabled={!data} />
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
    </div>
  )
}
