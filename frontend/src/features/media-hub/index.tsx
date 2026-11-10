import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { Cast, Gamepad2, GripVertical, RadioReceiver, Tv, Volume2 } from 'lucide-react'
import { api } from '@/lib/api'
import { applyOrder, moveItem } from '@/lib/layout-order'
import { cn } from '@/lib/utils'
import { HeaderIconButton } from '@/components/layout/header-icon-button'
import { useLayoutEdit } from '@/components/layout/layout-edit'
import { Page } from '@/components/layout/page'
import { Tabs, TabsContent, TabsList } from '@/components/ui/tabs'
import { MarantzTab } from '@/features/receiver/marantz-tab'
import { SamsungTab } from '@/features/tv-remote/samsung-tab'
import { UgoosTab } from '@/features/ugoos'
import { UniversalTab } from '@/features/universal'
import { VolumeTab } from '@/features/receiver/volume-tab'
import { MEDIA_TABS, MEDIA_TAB_TITLES, parseMediaTab, type MediaTab } from '@/lib/media-tabs'

type TabOrderResponse = { order: string[] }

// Иконки вкладок в шапке: UNIVERSAL — геймпад/пульт (несколько устройств кнопками), TV (Samsung) — классический
// телевизор с антенной (чтобы отличался от Universal), MARANTZ — приёмник (буквально «ресивер»), UGOOS — Cast
// (Android TV/Chromecast, чтобы отличался от Tv), VOLUME — громкость
const MEDIA_TAB_ICONS: Record<MediaTab, typeof Tv> = { universal: Gamepad2, samsung: Tv, marantz: RadioReceiver, ugoos: Cast, volume: Volume2 }

// Порядок самих вкладок (не кнопок внутри пульта): отдельный ключ /layout/media-tabs, чтобы не конфликтовать
// с порядком блоков ресивера (тот хранится под media-control через тот же переключатель «Изменить порядок» в шапке)
function useTabOrder() {
  const qc = useQueryClient()
  const key = ['layout', 'media-tabs']
  const { data } = useQuery({ queryKey: key, queryFn: async () => (await api.get<TabOrderResponse>('/layout/media-tabs')).data, staleTime: 5 * 60_000 })
  const save = useMutation({
    mutationFn: async (order: string[]) => (await api.put<TabOrderResponse>('/layout/media-tabs', { order })).data,
    onMutate: async (order) => qc.setQueryData<TabOrderResponse>(key, { order }),
  })
  const items = useMemo(() => MEDIA_TABS.map((t) => ({ id: t as string, title: MEDIA_TAB_TITLES[t] })), [])
  const ordered = useMemo(() => applyOrder(items, data?.order ?? []), [items, data])
  const order = ordered.map((t) => t.id as MediaTab)
  return { order, move: (from: number, to: number) => save.mutate(moveItem(order, from, to)) }
}

function SortableTabHandle({ id, title }: { id: MediaTab; title: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const Icon = MEDIA_TAB_ICONS[id]
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, touchAction: 'none' }}
      {...attributes}
      {...listeners}
      role='button'
      aria-label={`Перетащить вкладку «${title}»`}
      title={title}
      className={cn(
        'relative flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md border border-dashed border-info/60 bg-info/10 active:cursor-grabbing sm:size-7',
        isDragging && 'z-30 opacity-80',
      )}
    >
      <Icon className='size-4 text-info' aria-hidden />
      <GripVertical className='absolute -top-1.5 -right-1.5 size-3 rounded-full bg-background text-muted-foreground' aria-hidden />
    </div>
  )
}

// Сама сортировка вкладок — отдельным компонентом, который рендерится ВНУТРИ <Page> (как дети, через Tabs/TabsList).
// useLayoutEdit() должен звать потомок провайдера LayoutEditContext, а не MediaHubPage: тот сам рендерит <Page>,
// то есть стоит в дереве ВЫШЕ провайдера — его собственный вызов useLayoutEdit() всегда получал бы null,
// и кнопка в шапке молча ничего не переключала бы (edit.editing менялся, но сюда это никак не доходило)
//
// tab передаём явно и сравниваем сами (active={tab === t}), а не полагаемся на data-[state=active] от Radix:
// у «Громкости» этот Tabs.Root в шапке не содержит ни одной TabsContent (все TabsContent — в отдельном,
// втором Tabs-дереве ниже, вокруг самих вкладок на странице) — для universal/samsung/marantz Radix всё равно
// считает data-state верно по одному лишь совпадению value с контекстом, но наблюдалось, что именно для
// «Volume» (последняя вкладка) подсветка не применялась. Явное сравнение не зависит от этой internals-механики
// Radix вовсе и гарантированно работает одинаково для всех вкладок.
function MediaTabsList({ tab }: { tab: MediaTab }) {
  const edit = useLayoutEdit()
  const reordering = Boolean(edit?.editing)
  const tabOrder = useTabOrder()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    tabOrder.move(tabOrder.order.indexOf(e.active.id as MediaTab), tabOrder.order.indexOf(e.over.id as MediaTab))
  }

  return (
    // Тот же gap-0, что у шапки в целом (header.tsx) и у правой группы кнопок (page.tsx) — расстояние
    // между соседними кнопками одинаковое по всему ряду шапки, а не только внутри этой группы
    <TabsList className='h-auto w-fit shrink-0 gap-0 bg-transparent p-0'>
      {reordering ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={tabOrder.order} strategy={horizontalListSortingStrategy}>
            {tabOrder.order.map((t) => (
              <SortableTabHandle key={t} id={t} title={MEDIA_TAB_TITLES[t]} />
            ))}
          </SortableContext>
        </DndContext>
      ) : (
        tabOrder.order.map((t) => {
          const Icon = MEDIA_TAB_ICONS[t]
          return (
            // TabsPrimitive.Trigger (сырой, не обёрнутый ui/tabs.tsx TabsTrigger) — тот пришивает к
            // asChild-потомку свои классы (h-[calc(100%-1px)], rounded-md, px-2 py-1 и т.п.), и они через
            // twMerge внутри cn() у HeaderIconButton выигрывают у h-7/rounded-lg — отсюда и была разница
            // в размере с остальными кнопками ряда (проверено рендером: см. диагностику в истории правок).
            // Без обёртки — чистый <HeaderIconButton>, тот же самый компонент, что и у остальных кнопок.
            // Активное состояние — через data-[state=active] (Radix сам выставляет его на потомке)
            <TabsPrimitive.Trigger key={t} value={t} asChild>
              <HeaderIconButton title={MEDIA_TAB_TITLES[t]} aria-label={MEDIA_TAB_TITLES[t]} active={tab === t}>
                <Icon className='size-5' aria-hidden />
              </HeaderIconButton>
            </TabsPrimitive.Trigger>
          )
        })
      )}
    </TabsList>
  )
}

/** Страница «Пульт»: универсальный пульт, пульт ТВ, пульт ресивера, отдельный регулятор громкости */
export function MediaHubPage({ tab: raw }: { tab?: string }) {
  const tab = parseMediaTab(raw)
  const navigate = useNavigate()
  const setTab = (t: string) => void navigate({ to: '/media-control', search: { tab: t as MediaTab }, replace: true })

  return (
    <Page layoutPage={tab === 'universal' ? 'media-hub' : undefined} headerCenter={<Tabs value={tab} onValueChange={setTab}><MediaTabsList tab={tab} /></Tabs>}>
      <Tabs value={tab} onValueChange={setTab} className='gap-2'>
        <TabsContent value='universal' className='mt-0'>
          <UniversalTab />
        </TabsContent>
        <TabsContent value='samsung' className='mt-0'>
          <SamsungTab />
        </TabsContent>
        <TabsContent value='marantz' className='mt-0'>
          <MarantzTab />
        </TabsContent>
        <TabsContent value='ugoos' className='mt-0'>
          <UgoosTab />
        </TabsContent>
        <TabsContent value='volume' className='mt-0'>
          <VolumeTab />
        </TabsContent>
      </Tabs>
    </Page>
  )
}