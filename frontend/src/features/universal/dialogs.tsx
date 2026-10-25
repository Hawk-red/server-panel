import { useState } from 'react'
import { Check, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SCENE_COLORS, SCENE_ICONS, type SceneColor, type SceneIcon } from '@/lib/smarthome'
import { draftButton, filterItems, SOURCE_LABEL, type UniButton, type UniCatalog, type UniSource } from '@/lib/universal-pad'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SCENE_BG, SCENE_COLOR_LABEL, SCENE_ICON } from '@/features/smarthome/scene-style'

// Цвет и значок — те же, что у «Быстрых сцен»
function Look({ color, icon, onColor, onIcon }: { color: SceneColor; icon: SceneIcon; onColor: (c: SceneColor) => void; onIcon: (i: SceneIcon) => void }) {
  return (
    <>
      <div className='space-y-1.5'>
        <Label>Цвет</Label>
        <div className='flex flex-wrap gap-2' role='radiogroup' aria-label='Цвет'>
          {SCENE_COLORS.map((c) => (
            <button key={c} type='button' role='radio' aria-checked={color === c} aria-label={SCENE_COLOR_LABEL[c]} title={SCENE_COLOR_LABEL[c]} onClick={() => onColor(c)}
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
              <button key={i} type='button' role='radio' aria-checked={icon === i} aria-label={i} onClick={() => onIcon(i)}
                className={cn('flex size-9 items-center justify-center rounded-lg border', icon === i ? 'border-foreground bg-muted' : 'text-muted-foreground')}>
                <I className='size-5' />
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}

/** Подпись, цвет и значок плитки (и для новой, и для уже стоящей на пульте) */
export function TileDialog({ b, title, pending, onSave, onClose }: { b: UniButton; title: string; pending: boolean; onSave: (v: UniButton) => void; onClose: () => void }) {
  const [label, setLabel] = useState(b.label)
  const [color, setColor] = useState<SceneColor>(b.color)
  const [icon, setIcon] = useState<SceneIcon>(b.icon)
  const [err, setErr] = useState<string | null>(null)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const v = label.trim()
    if (v.length < 1 || v.length > 40) return setErr('Подпись: от 1 до 40 символов')
    onSave({ ...b, label: v, color, icon })
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className='space-y-4' noValidate>
          <div className='space-y-1.5'>
            <Label htmlFor='uni-label'>Подпись</Label>
            <Input id='uni-label' value={label} maxLength={40} autoFocus onChange={(e) => setLabel(e.target.value)} />
            {err && <p className='text-sm text-danger-foreground'>{err}</p>}
          </div>
          <Look color={color} icon={icon} onColor={setColor} onIcon={setIcon} />
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

/** Выбор источника и кнопки (или сцены) с поиском — первый шаг добавления плитки; источник по умолчанию задаёт столбец */
export function AddDialog({ catalog, taken, defaultSource = 'receiver', onPick, onClose }: { catalog: UniCatalog; taken: { id: string }[]; defaultSource?: UniSource; onPick: (b: UniButton) => void; onClose: () => void }) {
  // столбец предлагает кнопки своего устройства, но можно выбрать и другое устройство или сцену
  const [source, setSource] = useState<UniSource>(defaultSource)
  const [q, setQ] = useState('')
  type Item = { command: string; title: string; color?: SceneColor; icon?: SceneIcon; available?: boolean }
  const items: Item[] = source === 'scene' ? catalog.scenes : source === 'tv' ? catalog.tv : catalog.receiver
  const found = filterItems(items, q)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Добавить кнопку</DialogTitle>
        </DialogHeader>
        <Tabs value={source} onValueChange={(v) => (setSource(v as UniSource), setQ(''))}>
          <TabsList className='w-full'>
            {(['receiver', 'tv', 'scene'] as const).map((s) => (
              <TabsTrigger key={s} value={s} className='flex-1'>
                {SOURCE_LABEL[s]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className='relative'>
          <Search className='pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder='Поиск кнопки' className='ps-8' aria-label='Поиск кнопки' />
        </div>
        <div className='max-h-72 overflow-y-auto rounded-md border'>
          {found.length === 0 && <p className='p-4 text-center text-sm text-muted-foreground'>Ничего не нашлось</p>}
          {found.map((item) => (
            <button
              key={item.command}
              type='button'
              onClick={() => onPick(draftButton(source, item, taken))}
              className='flex w-full items-center gap-2 border-b px-3 py-2 text-start text-sm last:border-b-0 hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none'
            >
              <span className='truncate font-medium'>{item.title}</span>
              <span className='ms-auto shrink-0 font-mono text-xs text-muted-foreground'>{item.command}</span>
              {item.available === false && <span className='shrink-0 text-xs text-muted-foreground'>недоступна</span>}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button type='button' variant='outline' onClick={onClose}>
            Отмена
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
