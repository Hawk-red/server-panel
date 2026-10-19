import { useMemo, useState } from 'react'
import { Cable, ChevronDown, ExternalLink, Globe, Network, Search, SlidersHorizontal, Speaker, MonitorPlay, Volume2, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { highlightParts, RECEIVER_GROUPS, RECEIVER_LINKS, RECEIVER_ROOT_PATH, searchLinks, type ReceiverGroupId } from '@/lib/receiver-links'
import { HomeLink } from '@/components/home-link'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'

// Акцент группы: цвет текста значка и рамки плитки (контраст AA в светлой и тёмной теме)
const STYLE: Record<ReceiverGroupId, { icon: LucideIcon; text: string; tile: string }> = {
  audio: { icon: Volume2, text: 'text-blue-700 dark:text-blue-300', tile: 'border-l-blue-600 dark:border-l-blue-400' },
  video: { icon: MonitorPlay, text: 'text-violet-700 dark:text-violet-300', tile: 'border-l-violet-600 dark:border-l-violet-400' },
  inputs: { icon: Cable, text: 'text-orange-700 dark:text-orange-300', tile: 'border-l-orange-600 dark:border-l-orange-400' },
  speakers: { icon: Speaker, text: 'text-emerald-700 dark:text-emerald-300', tile: 'border-l-emerald-600 dark:border-l-emerald-400' },
  network: { icon: Network, text: 'text-sky-700 dark:text-sky-300', tile: 'border-l-sky-600 dark:border-l-sky-400' },
  general: { icon: SlidersHorizontal, text: 'text-pink-700 dark:text-pink-300', tile: 'border-l-pink-600 dark:border-l-pink-400' },
}

function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((p, i) =>
        p.match ? (
          <mark key={i} className='rounded-sm bg-yellow-300 px-0.5 text-black'>
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}

/** Ссылки на настройки ресивера: одна конфигурация (lib/receiver-links.ts) и на странице пульта, и в карточке «Медиа» */
export function ReceiverSettingsLinks() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({ audio: true })
  const searching = query.trim() !== ''
  const found = useMemo(() => searchLinks(RECEIVER_LINKS, query), [query])

  return (
    <div className='@container space-y-3'>
      <Button asChild size='lg' className='h-12 w-full'>
        <HomeLink service='marantz' path={RECEIVER_ROOT_PATH} rel='noopener noreferrer'>
          <Globe /> Открыть весь веб-интерфейс ресивера
        </HomeLink>
      </Button>
      <div className='relative'>
        <Search className='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' aria-hidden />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder='Найти настройку…' aria-label='Поиск по ссылкам на настройки ресивера' className='h-11 pl-9 pr-10' />
        {query && (
          <Button variant='ghost' size='icon' className='absolute right-0 top-1/2 size-11 -translate-y-1/2' aria-label='Очистить поиск' onClick={() => setQuery('')}>
            <X />
          </Button>
        )}
      </div>
      {searching && found.length === 0 && <p className='text-sm text-muted-foreground'>Ничего не найдено.</p>}
      {RECEIVER_GROUPS.map((g) => {
        const links = found.filter((l) => l.group === g.id)
        if (searching && links.length === 0) return null
        const st = STYLE[g.id]
        const Icon = st.icon
        const isOpen = searching || open[g.id] === true
        return (
          <Collapsible key={g.id} open={isOpen} onOpenChange={(v) => setOpen((o) => ({ ...o, [g.id]: v }))}>
            <CollapsibleTrigger asChild>
              <button type='button' className='flex min-h-12 w-full items-center gap-2 rounded-lg border px-3 text-left hover:bg-muted' style={{ touchAction: 'manipulation' }}>
                <Icon className={cn('size-5 shrink-0', st.text)} aria-hidden />
                <span className='font-medium'>{g.ru}</span>
                <span className='text-xs text-muted-foreground'>{g.en}</span>
                <span className={cn('ms-auto rounded-full border px-2 text-xs tabular-nums', st.text)}>{links.length}</span>
                <ChevronDown className={cn('size-4 shrink-0 transition-transform', isOpen && 'rotate-180')} aria-hidden />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className='pt-2'>
              <div className='grid grid-cols-2 gap-2 @lg:grid-cols-3 @3xl:grid-cols-4'>
                {links.map((l) => (
                  <HomeLink
                    key={l.path}
                    service='marantz'
                    path={l.path}
                    rel='noopener noreferrer'
                    title={l.hint}
                    className={cn('flex h-full min-h-16 min-w-0 flex-col justify-center gap-0.5 rounded-lg border border-l-4 px-3 py-2 [overflow-wrap:anywhere] hover:bg-muted', st.tile)}
                  >
                    <span className='flex items-start justify-between gap-1 text-sm font-medium leading-tight'>
                      <span>
                        <Marked text={l.ru} query={query} />
                      </span>
                      <ExternalLink className='mt-0.5 size-3 shrink-0 text-muted-foreground' aria-hidden />
                    </span>
                    <span className='text-[11px] leading-tight text-muted-foreground'>
                      <Marked text={l.en} query={query} />
                    </span>
                  </HomeLink>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )
      })}
    </div>
  )
}
