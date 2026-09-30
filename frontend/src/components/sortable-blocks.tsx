import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, GripVertical, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useLayoutEdit } from '@/components/layout/layout-edit'
import { Button } from '@/components/ui/button'

// Блок страницы: постоянный id (по нему хранится порядок), заголовок для подписи в режиме изменения, вёрстка блока
export type Block = { id: string; title: string; node: React.ReactNode; className?: string }

type LayoutResponse = { order: string[] }

// Порядок из настроек применяется к блокам: сохранённые — по порядку, новые (которых там нет) — в конец, исчезнувшие — игнорируются
export function applyOrder<T extends { id: string }>(blocks: T[], saved: string[]): T[] {
  const byId = new Map(blocks.map((b) => [b.id, b]))
  const known = saved.filter((id) => byId.has(id)).map((id) => byId.get(id)!)
  const rest = blocks.filter((b) => !saved.includes(b.id))
  return [...known, ...rest]
}

function Item({ block, editing, index, count, onMove }: { block: Block; editing: boolean; index: number; count: number; onMove: (from: number, to: number) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: block.id, disabled: !editing })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('min-w-0', block.className, editing && 'relative rounded-xl outline-2 outline-offset-2 outline-dashed outline-info/60', isDragging && 'z-30 opacity-80')}
    >
      {/* В режиме изменения содержимое «заморожено»: нажатия и фокус не проходят внутрь, чтобы блок можно было схватить в любом месте */}
      <div className={cn('h-full [&>*]:h-full', editing && 'pointer-events-none select-none')} inert={editing}>
        {block.node}
      </div>
      {editing && (
        <>
          <div
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            role='button'
            aria-label={`Перетащить блок «${block.title}»`}
            className='absolute inset-0 z-10 cursor-grab touch-none rounded-xl bg-info/5 active:cursor-grabbing'
          />
          <div className='pointer-events-none absolute start-3 -top-3.5 z-20 inline-flex max-w-[calc(100%-6.5rem)] items-center gap-1 rounded-md bg-background/95 px-2 py-1 text-sm font-medium shadow ring-1 ring-border'>
            <GripVertical className='size-4 shrink-0 text-muted-foreground' aria-hidden /> <span className='truncate'>{block.title}</span>
          </div>
          <div className='absolute end-3 -top-3.5 z-20 flex gap-1'>
            <Button type='button' size='icon' variant='secondary' className='size-8 shadow ring-1 ring-border' disabled={index === 0} onClick={() => onMove(index, index - 1)} aria-label={`Поднять блок «${block.title}»`}>
              <ArrowUp />
            </Button>
            <Button type='button' size='icon' variant='secondary' className='size-8 shadow ring-1 ring-border' disabled={index === count - 1} onClick={() => onMove(index, index + 1)} aria-label={`Опустить блок «${block.title}»`}>
              <ArrowDown />
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Блоки страницы с порядком, который можно менять перетаскиванием (мышью, пальцем, стрелками ▲▼ или с клавиатуры).
 * Порядок хранится на сервере (общий для всех устройств). Работает внутри <Page layoutPage='…'>: кнопка режима — в шапке.
 */
export function SortableBlocks({ blocks, className, grid = false }: { blocks: Block[]; className?: string; grid?: boolean }) {
  const edit = useLayoutEdit()
  const qc = useQueryClient()
  const page = edit?.page ?? ''
  const editing = Boolean(edit?.editing)
  const key = ['layout', page]

  const { data } = useQuery({ queryKey: key, queryFn: async () => (await api.get<LayoutResponse>(`/layout/${page}`)).data, enabled: Boolean(page), staleTime: 5 * 60_000 })
  const save = useMutation({
    mutationFn: async (order: string[]) => (await api.put<LayoutResponse>(`/layout/${page}`, { order })).data,
    onMutate: async (order) => {
      qc.setQueryData<LayoutResponse>(key, { order })
    },
    onError: () => {
      toast.error('Порядок не сохранился')
      qc.invalidateQueries({ queryKey: key })
    },
  })

  const ordered = useMemo(() => applyOrder(blocks, data?.order ?? []), [blocks, data])
  const ids = ordered.map((b) => b.id)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const move = (from: number, to: number) => save.mutate(arrayMove(ids, from, to))
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    move(ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)))
  }

  return (
    <>
      {editing && edit && (
        <div className='mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-info/50 bg-info/10 px-3 py-2 text-sm'>
          <span className='me-auto'>Режим изменения порядка: перетащите блок за любое место, либо используйте стрелки ▲▼ на блоке.</span>
          <Button type='button' size='sm' variant='outline' onClick={() => save.mutate([])} disabled={!data?.order.length}>
            <RotateCcw /> Сбросить порядок
          </Button>
          <Button type='button' size='sm' onClick={() => edit.setEditing(false)}>
            Готово
          </Button>
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={grid ? rectSortingStrategy : verticalListSortingStrategy}>
          <div className={cn(!className && 'space-y-4', className, editing && 'gap-y-9 sm:gap-y-9')}>
            {ordered.map((b, i) => (
              <Item key={b.id} block={b} editing={editing} index={i} count={ordered.length} onMove={move} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </>
  )
}
