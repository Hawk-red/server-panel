import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Ellipsis, Eye, EyeOff, Loader2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { runScene, type Scene, type SceneColor, type SceneIcon, SCENE_COLORS, SCENE_ICONS, sceneRunnable, SCENES_LAYOUT_PAGE, type SmartHomeData } from '@/lib/smarthome'
import { cn } from '@/lib/utils'
import { type Block, SortableBlocks } from '@/components/sortable-blocks'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SCENE_BG, SCENE_COLOR_LABEL, SCENE_ICON } from './scene-style'
import { apiError } from './icons'

type Phase = 'busy' | 'done' | 'error'

function useSceneActions() {
  const qc = useQueryClient()
  const patch = useMutation({
    mutationFn: async (v: { entityId: string; body: { name?: string | null; color?: SceneColor | null; icon?: SceneIcon | null; hidden?: boolean } }) =>
      (await api.patch<Scene>('/smarthome/scenes', { entity_id: v.entityId, ...v.body })).data,
    onSuccess: (s) => {
      qc.setQueryData<SmartHomeData>(['smarthome'], (d) => d && { ...d, scenes: d.scenes.map((x) => (x.entityId === s.entityId ? s : x)) })
    },
    onError: (e) => toast.error(apiError(e).message ?? 'Не удалось сохранить'),
  })
  return patch
}

function SceneTile({ s, editing, interactive, phase, onRun, onEdit, onHide }: {
  s: Scene
  editing: boolean // режим изменения порядка: нажатие не запускает сцену
  interactive: boolean // меню «⋯» доступно (не в режиме перетаскивания плиток)
  phase: Phase | undefined
  onRun: (s: Scene) => void
  onEdit: (s: Scene) => void
  onHide: (s: Scene, hidden: boolean) => void
}) {
  const Icon = SCENE_ICON[s.icon] ?? SCENE_ICON.sparkles
  const runnable = sceneRunnable(s)
  const off = !s.available || s.missing
  return (
    <div className={cn('relative h-full', (s.hidden || s.missing) && 'opacity-50')}>
      <button
        type='button'
        onClick={() => onRun(s)}
        disabled={!runnable || editing || phase === 'busy'}
        aria-label={`Запустить сцену ${s.name}`}
        className={cn(
          'flex h-full min-h-28 w-full flex-col justify-between rounded-2xl p-4 text-left text-white shadow-sm transition-transform duration-100 select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
          off ? 'bg-muted text-muted-foreground' : SCENE_BG[s.color],
          runnable && !editing && 'active:scale-95',
          phase === 'busy' && 'scale-95',
          phase === 'error' && 'ring-4 ring-red-500 ring-offset-2 ring-offset-background',
          !runnable && 'cursor-not-allowed'
        )}
      >
        <span className='flex size-9 items-center justify-center rounded-full bg-white/20'>
          {phase === 'busy' ? <Loader2 className='size-5 animate-spin' /> : phase === 'done' ? <Check className='size-5' /> : <Icon className='size-5' />}
        </span>
        <span className='line-clamp-2 text-lg leading-tight font-semibold break-words'>{s.name}</span>
        {!s.available && !s.missing && <span className='sr-only'>недоступно</span>}
      </button>
      {interactive && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size='icon' variant='ghost' className='absolute end-1.5 top-1.5 size-8 text-white hover:bg-white/20 hover:text-white' aria-label={`Действия со сценой ${s.name}`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onSelect={() => onEdit(s)}>
              <Pencil /> Имя, цвет, значок…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onHide(s, !s.hidden)}>
              {s.hidden ? <Eye /> : <EyeOff />} {s.hidden ? 'Показать' : 'Скрыть'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

function SceneDialog({ s, pending, onSave, onClose }: { s: Scene; pending: boolean; onSave: (b: { name: string | null; color: SceneColor; icon: SceneIcon }) => void; onClose: () => void }) {
  const [name, setName] = useState(s.name)
  const [color, setColor] = useState<SceneColor>(s.color)
  const [icon, setIcon] = useState<SceneIcon>(s.icon)
  const [err, setErr] = useState<string | null>(null)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const v = name.trim()
    if (v.length < 1 || v.length > 60) return setErr('Название: от 1 до 60 символов')
    onSave({ name: v === s.name && !s.nameCustom ? null : v, color, icon }) // имя не менялось — остаётся имя из HA
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Сцена «{s.haName}»</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className='space-y-4' noValidate>
          <div className='space-y-1.5'>
            <Label htmlFor='scene-name'>Название</Label>
            <Input id='scene-name' value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} />
            {err && <p className='text-sm text-danger-foreground'>{err}</p>}
          </div>
          <div className='space-y-1.5'>
            <Label>Цвет</Label>
            <div className='flex flex-wrap gap-2' role='radiogroup' aria-label='Цвет'>
              {SCENE_COLORS.map((c) => (
                <button key={c} type='button' role='radio' aria-checked={color === c} aria-label={SCENE_COLOR_LABEL[c]} title={SCENE_COLOR_LABEL[c]} onClick={() => setColor(c)}
                  className={cn('flex size-8 items-center justify-center rounded-full text-white', SCENE_BG[c], color === c && 'ring-2 ring-foreground ring-offset-2 ring-offset-background')}>
                  {color === c && <Check className='size-4' />}
                </button>
              ))}
            </div>
          </div>
          <div className='space-y-1.5'>
            <Label>Значок</Label>
            <div className='flex flex-wrap gap-2' role='radiogroup' aria-label='Значок'>
              {SCENE_ICONS.map((i) => {
                const I = SCENE_ICON[i]
                return (
                  <button key={i} type='button' role='radio' aria-checked={icon === i} aria-label={i} onClick={() => setIcon(i)}
                    className={cn('flex size-9 items-center justify-center rounded-lg border', icon === i ? 'border-foreground bg-muted' : 'text-muted-foreground')}>
                    <I className='size-5' />
                  </button>
                )
              })}
            </div>
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose} disabled={pending}>
              Отмена
            </Button>
            <Button type='submit' disabled={pending}>
              {pending ? 'Сохраняю…' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// Блок «Быстрые сцены»: цветные плитки сцен Home Assistant. editing — режим изменения порядка (запуск отключён), sortable — плитки перетаскиваются.
export function SceneTiles({ scenes, editing, sortable }: { scenes: Scene[]; editing: boolean; sortable: boolean }) {
  const patch = useSceneActions()
  const [phases, setPhases] = useState<Record<string, Phase>>({})
  const [editScene, setEditScene] = useState<Scene | null>(null)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const setPhase = (id: string, p: Phase | undefined) =>
    setPhases((m) => {
      const n = { ...m }
      if (p) n[id] = p
      else delete n[id]
      return n
    })
  const run = async (s: Scene) => {
    if (phases[s.entityId] === 'busy') return
    setPhase(s.entityId, 'busy')
    const r = await runScene((id) => api.post('/smarthome/ha/scene', { entity_id: id }), s.entityId, (e) => apiError(e).message ?? 'Не удалось запустить сцену')
    if (r.ok) setPhase(s.entityId, 'done')
    else {
      setPhase(s.entityId, 'error')
      toast.error(`${s.name}: ${r.message}`)
    }
    timers.current.push(window.setTimeout(() => setPhase(s.entityId, undefined), r.ok ? 1000 : 2500))
  }

  const blocks: Block[] = scenes.map((s) => ({
    id: s.id,
    title: s.name,
    node: <SceneTile s={s} editing={editing} interactive={!sortable} phase={phases[s.entityId]} onRun={run} onEdit={setEditScene} onHide={(x, hidden) => patch.mutate({ entityId: x.entityId, body: { hidden } })} />,
  }))
  return (
    <>
      <SortableBlocks pageKey={SCENES_LAYOUT_PAGE} blocks={blocks} grid stable banner={false} sortable={sortable} className='grid grid-cols-2 gap-3 lg:grid-cols-4' />
      {editScene && (
        <SceneDialog s={editScene} pending={patch.isPending} onClose={() => setEditScene(null)}
          onSave={(b) => patch.mutate({ entityId: editScene.entityId, body: b }, { onSuccess: () => setEditScene(null) })} />
      )}
    </>
  )
}
