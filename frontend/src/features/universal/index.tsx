import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AxiosError } from 'axios'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { moveItem } from '@/lib/layout-order'
import { bumpVolume } from '@/lib/receiver-remote'
import { controlStateOf, performToggle, runScene, type ControlState, type SmartHomeData, type ToggleResult } from '@/lib/smarthome'
import { removeButton, stripView, uniRepeatable, UNI_COLUMNS, UNI_COLUMN_TITLE, upsertButton, type DeviceState, type UniButton, type UniButtonView, type UniColumn, type UniData } from '@/lib/universal-pad'
import { type Block, SortableBlocks } from '@/components/sortable-blocks'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useReceiver } from '@/features/receiver/use-receiver'
import { VolumeControl } from '@/features/receiver/volume-control'
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

/** Живые состояния выключателей: тот же запрос и тот же опрос (3 с), что и на странице «Умный дом» */
function useSwitches(entityIds: string[]) {
  const qc = useQueryClient()
  const key = ['smarthome']
  const q = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<SmartHomeData>('/smarthome/devices')).data,
    refetchInterval: 3000,
    enabled: entityIds.length > 0,
  })
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())

  const states: Record<string, ControlState> = {}
  for (const id of entityIds) {
    const st = controlStateOf(q.data, id)
    if (st) states[id] = st
  }

  // Оптимистичное переключение общей функцией «Умного дома»: ответ сервера подставляется сразу, при ошибке — откат
  const toggle = async (entityId: string, label: string) => {
    if (busy.has(entityId)) return
    setBusy((b) => new Set([...b, entityId]))
    try {
      await performToggle(
        {
          get: () => qc.getQueryData<SmartHomeData>(key),
          set: (d) => qc.setQueryData(key, d),
          post: async (id, action) => (await api.post<ToggleResult>('/smarthome/ha/toggle', { entity_id: id, action })).data,
        },
        entityId,
        controlStateOf(qc.getQueryData<SmartHomeData>(key), entityId) !== 'on',
      )
    } catch (e) {
      toast.error(errText(e, `Не удалось переключить «${label}»`))
    } finally {
      setBusy((b) => new Set([...b].filter((x) => x !== entityId)))
    }
  }
  return { states, busy, toggle }
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
  busy: ReadonlySet<string>
  pending: boolean
  onPress: (b: UniButtonView) => void
  onSave: (column: UniColumn, buttons: UniButton[]) => void
}

function Column({ column, data, st, busy, pending, onPress, onSave }: ColumnProps) {
  // Своё, независимое от шапки, переключение режима изменения: тумблер «Изменить» ниже отвечает только за кнопки
  // этой карточки (порядок самих вкладок UNIVERSAL/TV/MARANTZ/VOLUME — отдельная сортировка в шапке страницы)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editTile, setEditTile] = useState<{ b: UniButton; isNew: boolean } | null>(null)
  const col = data?.columns?.[column]
  const buttons = col?.buttons ?? []
  const list = () => buttons.map(stripView)

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

  // Одна общая сетка на всю карточку (UniversalPad сам распределяет колонки по своей ширине через @container) —
  // раньше кнопки делились на две независимые половины со своими отступами, из-за чего последняя (например, MUTE)
  // могла оказаться одна в своём под-гриде и визуально «съезжать» относительно остальных
  const grid = (
    <UniversalPad
      buttons={buttons}
      st={st}
      editing={editing}
      busy={busy}
      onPress={onPress}
      onEdit={(b: UniButtonView) => setEditTile({ b: stripView(b), isNew: false })}
      onRemove={(b: UniButtonView) => onSave(column, removeButton(list(), b.id))}
      wrap={editing ? (b, node) => <SortableTile id={b.id}>{node}</SortableTile> : undefined}
    />
  )

  return (
    <section className='space-y-3 rounded-xl border p-3' aria-label={`UNIVERSAL: ${UNI_COLUMN_TITLE[column]}`} data-column={column}>
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

      <div className='flex items-center justify-end gap-2 pt-2'>
        <Label htmlFor={`${column}-edit`} className='text-sm'>Изменить</Label>
        <Switch id={`${column}-edit`} checked={editing} onCheckedChange={setEditing} disabled={!data} />
      </div>
    </section>
  )
}

/** Вкладка «Универсальный»: два столбца частых кнопок — слева телевизор, сцены и выключатели, справа ресивер */
export function UniversalTab() {
  const { data, save, pending } = useUniversal()
  const { q: receiver, send, patch } = useReceiver()
  const tv = useTvStatus()
  const tvPress = useTvPress(tv.data)
  const switchIds = UNI_COLUMNS.flatMap((c) => data?.columns?.[c]?.buttons ?? [])
    .filter((b) => b.source === 'switch' && b.resolved)
    .map((b) => b.resolved as string)
  const sw = useSwitches(switchIds)
  const st: DeviceState = { receiver: receiver.data, tv: tv.data, switches: sw.states }

  const press = (b: UniButtonView) => {
    if (!b.resolved) return
    if (b.source === 'receiver') {
      if (b.resolved === 'MVUP' || b.resolved === 'MVDOWN') patch((s) => bumpVolume(s, b.resolved as 'MVUP' | 'MVDOWN'))
      void send(b.resolved, { quiet: uniRepeatable(b) })
      return
    }
    if (b.source === 'tv') return void tvPress(b.id, b.resolved)
    if (b.source === 'switch') return void sw.toggle(b.resolved, b.label)
    void runScene((id) => api.post('/smarthome/ha/scene', { entity_id: id }), b.resolved, (e) => errText(e, 'Не удалось запустить сцену')).then((r) =>
      r.ok ? toast.success(`Сцена «${b.label}» запущена`) : toast.error(r.message),
    )
  }

  const onSave = (column: UniColumn, buttons: UniButton[]) => save({ column, buttons })
  // Три самостоятельные карточки-блока — TV, Громкость, Marantz — с общим порядком, который можно менять
  // перетаскиванием при включённом режиме сортировки в шапке (как у порядка вкладок, но отдельный ключ)
  const blocks: Block[] = [
    { id: 'tv', title: 'TV — кнопки', node: <Column column='tv' data={data} st={st} busy={sw.busy} pending={pending} onPress={press} onSave={onSave} /> },
    { id: 'volume', title: 'Громкость', node: <VolumeControl /> },
    { id: 'marantz', title: 'Marantz — кнопки', node: <Column column='receiver' data={data} st={st} busy={sw.busy} pending={pending} onPress={press} onSave={onSave} /> },
  ]
  // items-start: блоки не вытягиваются по самому высокому — иначе под коротким висит пустота
  return <SortableBlocks grid blocks={blocks} className='grid gap-6 items-start md:grid-cols-2' />
}