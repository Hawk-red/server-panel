import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ArrowRight, ChevronRight, Laptop, Moon, Sun } from 'lucide-react'
import { api } from '@/lib/api'
import { buildPaletteItems, GROUP_HEADING, paletteFilter, type PaletteGroup } from '@/lib/palette'
import { runScene, type SmartHomeData } from '@/lib/smarthome'
import type { DiskInfo, DockerData, MediaData, NetworkData, ServiceRow, TorrentsData } from '@/lib/types'
import { useSearch } from '@/context/search-provider'
import { useTheme } from '@/context/theme-provider'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { sidebarData } from './layout/data/sidebar-data'
import { ScrollArea } from './ui/scroll-area'

export function CommandMenu() {
  const navigate = useNavigate()
  const { setTheme } = useTheme()
  const { open, setOpen } = useSearch()
  const [query, setQuery] = React.useState('')
  const changeOpen = (v: boolean) => {
    if (!v) setQuery('')
    setOpen(v)
  }

  // Данные для поиска — те же запросы на чтение, что и на страницах (общий кеш react-query). Грузятся при открытии палитры,
  // а не после первой буквы: иначе первые секунды было бы «Ничего не найдено». Новых обращений к qBittorrent/Docker нет.
  const opts = { enabled: open, staleTime: 15_000 }
  const torrents = useQuery({ queryKey: ['torrents'], queryFn: async () => (await api.get<TorrentsData>('/torrents')).data, ...opts })
  const docker = useQuery({ queryKey: ['docker'], queryFn: async () => (await api.get<DockerData>('/docker')).data, ...opts })
  const services = useQuery({ queryKey: ['services'], queryFn: async () => (await api.get<ServiceRow[]>('/system/services')).data, ...opts })
  const disks = useQuery({ queryKey: ['disks'], queryFn: async () => (await api.get<DiskInfo[]>('/system/disks')).data, ...opts })
  const network = useQuery({ queryKey: ['network'], queryFn: async () => (await api.get<NetworkData>('/network')).data, ...opts })
  const media = useQuery({ queryKey: ['media'], queryFn: async () => (await api.get<MediaData>('/media')).data, ...opts })
  const smarthome = useQuery({ queryKey: ['smarthome'], queryFn: async () => (await api.get<SmartHomeData>('/smarthome/devices')).data, ...opts })
  const loading = [torrents, docker, services, disks, network, media].some((q) => q.isLoading)
  const searching = query.trim() !== ''
  const items = React.useMemo(
    () =>
      searching
        ? buildPaletteItems({ torrents: torrents.data, docker: docker.data, services: services.data, disks: disks.data, network: network.data, media: media.data, scenes: smarthome.data?.scenes })
        : [],
    [searching, torrents.data, docker.data, services.data, disks.data, network.data, media.data, smarthome.data]
  )

  const runCommand = React.useCallback(
    (command: () => unknown) => {
      setQuery('')
      setOpen(false)
      command()
    },
    [setOpen]
  )

  // Порядок групп при поиске задаём сами: разделы меню и данные — один список, группа с лучшим баллом первой
  // (не полагаемся на перестановку DOM внутри cmdk). Без запроса порядок прежний: разделы, затем данные.
  const q = query.trim()
  const score = (value: string, keywords: string[]) => (q ? paletteFilter(value, q, keywords) : 0)
  const groups = [
    ...sidebarData.navGroups.map((group) => ({
      key: `nav:${group.title}`,
      score: Math.max(
        0,
        ...group.items.flatMap((navItem) =>
          navItem.url
            ? [score(navItem.title, [group.title, String(navItem.url)])]
            : (navItem.items ?? []).map((sub) => score(`${navItem.title} ${sub.title}`, [group.title, String(sub.url)]))
        )
      ),
      node: (
        <CommandGroup key={group.title} heading={group.title}>
          {group.items.map((navItem, i) => {
            if (navItem.url)
              return (
                <CommandItem
                  key={`${navItem.url}-${i}`}
                  value={navItem.title}
                  keywords={[group.title, String(navItem.url)]}
                  onSelect={() => {
                    runCommand(() => navigate({ to: navItem.url }))
                  }}
                >
                  <div className='flex size-4 items-center justify-center'>
                    <ArrowRight className='size-2 text-muted-foreground/80' />
                  </div>
                  {navItem.title}
                </CommandItem>
              )

            return navItem.items?.map((subItem, i) => (
              <CommandItem
                key={`${navItem.title}-${subItem.url}-${i}`}
                value={`${navItem.title} ${subItem.title}`}
                keywords={[group.title, String(subItem.url)]}
                onSelect={() => {
                  runCommand(() => navigate({ to: subItem.url }))
                }}
              >
                <div className='flex size-4 items-center justify-center'>
                  <ArrowRight className='size-2 text-muted-foreground/80' />
                </div>
                {navItem.title} <ChevronRight /> {subItem.title}
              </CommandItem>
            ))
          })}
        </CommandGroup>
      ),
    })),
    ...(Object.keys(GROUP_HEADING) as PaletteGroup[]).map((g) => {
      const rows = items.filter((it) => it.group === g)
      return {
        key: `data:${g}`,
        score: Math.max(0, ...rows.map((it) => score(it.id, it.keywords))),
        node:
          rows.length === 0 ? null : (
            <CommandGroup key={g} heading={GROUP_HEADING[g]}>
              {rows.map((it) => (
                <CommandItem key={it.id} value={it.id} keywords={it.keywords} onSelect={() =>
                    runCommand(() => {
                      if (!it.scene) return navigate({ to: it.to, search: it.search as never })
                      const name = it.title.replace(/^Сцена: /, '')
                      void runScene((id) => api.post('/smarthome/ha/scene', { entity_id: id }), it.scene, (e) => (e as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Не удалось запустить сцену').then((r) =>
                        r.ok ? toast.success(`Сцена «${name}» запущена`) : toast.error(r.message)
                      )
                    })
                  }>
                  <ArrowRight className='text-muted-foreground/80' />
                  <span className='truncate'>{it.title}</span>
                  {it.subtitle && <span className='ms-auto truncate text-xs text-muted-foreground'>{it.subtitle}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          ),
      }
    }),
  ].sort((a, b) => b.score - a.score) // sort стабильный: при пустом запросе (все 0) порядок прежний

  return (
    <CommandDialog modal open={open} onOpenChange={changeOpen} filter={paletteFilter}>
      <CommandInput placeholder='Раздел, торрент, служба, контейнер, диск…' value={query} onValueChange={setQuery} />
      <CommandList>
        <ScrollArea type='hover' className='h-72 pe-1'>
          <CommandEmpty>{loading ? 'Загружаю данные…' : 'Ничего не найдено.'}</CommandEmpty>
          {groups.map((b) => b.node)}
          <CommandSeparator />
          <CommandGroup heading='Тема'>
            <CommandItem value='Тема светлая' keywords={['light', 'theme']} onSelect={() => runCommand(() => setTheme('light'))}>
              <Sun /> <span>Светлая</span>
            </CommandItem>
            <CommandItem value='Тема тёмная' keywords={['dark', 'theme']} onSelect={() => runCommand(() => setTheme('dark'))}>
              <Moon className='scale-90' />
              <span>Тёмная</span>
            </CommandItem>
            <CommandItem value='Тема как в системе' keywords={['system', 'theme', 'auto']} onSelect={() => runCommand(() => setTheme('system'))}>
              <Laptop />
              <span>Как в системе</span>
            </CommandItem>
          </CommandGroup>
        </ScrollArea>
      </CommandList>
    </CommandDialog>
  )
}
