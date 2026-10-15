import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, ChevronRight, Laptop, Moon, Sun } from 'lucide-react'
import { api } from '@/lib/api'
import { createMatcher } from '@/lib/search'
import type { DiskInfo, DockerData, NetworkData, ServiceRow, TorrentsData } from '@/lib/types'
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
  // Один матчер на запрос: регистр, ё/е, транслит, раскладка, слова в любом порядке, опечатки (lib/search.ts)
  const match = React.useMemo(() => createMatcher(query), [query])
  const filter = React.useCallback((value: string, _search: string, keywords?: string[]) => match(value, ...(keywords ?? [])), [match])
  const changeOpen = (v: boolean) => {
    if (!v) setQuery('')
    setOpen(v)
  }
  const searching = open && query.trim() !== ''

  // Данные для поиска — те же запросы на чтение, что и на страницах (общий кеш react-query), и только пока палитра открыта с запросом
  const torrents = useQuery({ queryKey: ['torrents'], queryFn: async () => (await api.get<TorrentsData>('/torrents')).data, enabled: searching, staleTime: 15_000 })
  const docker = useQuery({ queryKey: ['docker'], queryFn: async () => (await api.get<DockerData>('/docker')).data, enabled: searching, staleTime: 15_000 })
  const services = useQuery({ queryKey: ['services'], queryFn: async () => (await api.get<ServiceRow[]>('/system/services')).data, enabled: searching, staleTime: 15_000 })
  const disks = useQuery({ queryKey: ['disks'], queryFn: async () => (await api.get<DiskInfo[]>('/system/disks')).data, enabled: searching, staleTime: 15_000 })
  const network = useQuery({ queryKey: ['network'], queryFn: async () => (await api.get<NetworkData>('/network')).data, enabled: searching, staleTime: 15_000 })
  const torrentRows = torrents.data?.summary.data?.active ?? []
  const containerRows = docker.data?.containers.data ?? []
  const imageRows = docker.data?.images.data ?? []
  const serviceRows = services.data ?? []
  const diskRows = disks.data ?? []
  const deviceRows = network.data?.devices ?? []

  const runCommand = React.useCallback(
    (command: () => unknown) => {
      setQuery('')
      setOpen(false)
      command()
    },
    [setOpen]
  )

  return (
    <CommandDialog modal open={open} onOpenChange={changeOpen} filter={filter}>
      <CommandInput placeholder='Раздел, торрент, служба, контейнер, диск…' value={query} onValueChange={setQuery} />
      <CommandList>
        <ScrollArea type='hover' className='h-72 pe-1'>
          <CommandEmpty>Ничего не найдено.</CommandEmpty>
          {sidebarData.navGroups.map((group) => (
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
          ))}
          {searching && torrentRows.length > 0 && (
            <CommandGroup heading='Торренты (активные)'>
              {torrentRows.map((t) => (
                <CommandItem key={t.hash} value={`torrent ${t.hash}`} keywords={[t.name, t.state]} onSelect={() => runCommand(() => navigate({ to: '/torrents' }))}>
                  <ArrowRight className='text-muted-foreground/80' />
                  <span className='truncate'>{t.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {searching && (containerRows.length > 0 || imageRows.length > 0) && (
            <CommandGroup heading='Docker'>
              {containerRows.map((c) => (
                <CommandItem key={c.id} value={`container ${c.id}`} keywords={[c.name, c.image, c.state, c.composeProject ?? '']} onSelect={() => runCommand(() => navigate({ to: '/docker' }))}>
                  <ArrowRight className='text-muted-foreground/80' />
                  <span className='truncate'>{c.name}</span>
                  <span className='ms-auto truncate text-xs text-muted-foreground'>{c.image}</span>
                </CommandItem>
              ))}
              {imageRows.map((i) => (
                <CommandItem key={i.id} value={`image ${i.id}`} keywords={i.tags} onSelect={() => runCommand(() => navigate({ to: '/docker' }))}>
                  <ArrowRight className='text-muted-foreground/80' />
                  <span className='truncate'>{i.tags[0] ?? i.id.slice(0, 19)}</span>
                  <span className='ms-auto text-xs text-muted-foreground'>образ</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {searching && serviceRows.length > 0 && (
            <CommandGroup heading='Службы'>
              {serviceRows.map((s) => (
                <CommandItem key={s.unit} value={`service ${s.unit}`} keywords={[s.description]} onSelect={() => runCommand(() => navigate({ to: '/system', search: { tab: 'services' } }))}>
                  <ArrowRight className='text-muted-foreground/80' />
                  <span className='truncate'>{s.unit}</span>
                  <span className='ms-auto truncate text-xs text-muted-foreground'>{s.description}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {searching && diskRows.length > 0 && (
            <CommandGroup heading='Диски'>
              {diskRows.map((d) => (
                <CommandItem key={d.device} value={`disk ${d.device}`} keywords={[d.label ?? '', d.model ?? '', d.mount ?? '', d.uuid ?? '', d.fstype ?? '']} onSelect={() => runCommand(() => navigate({ to: '/disks' }))}>
                  <ArrowRight className='text-muted-foreground/80' />
                  <span className='truncate'>{d.label || d.model || d.device}</span>
                  <span className='ms-auto truncate text-xs text-muted-foreground'>{d.mount ?? d.device}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {searching && deviceRows.length > 0 && (
            <CommandGroup heading='Устройства сети'>
              {deviceRows.map((d) => (
                <CommandItem key={d.mac} value={`device ${d.mac}`} keywords={[d.name ?? '', d.hostname ?? '', d.vendor ?? '', d.ip, d.location ?? '', d.note ?? '']} onSelect={() => runCommand(() => navigate({ to: '/network' }))}>
                  <ArrowRight className='text-muted-foreground/80' />
                  <span className='truncate'>{d.name || d.hostname || d.vendor || d.mac}</span>
                  <span className='ms-auto text-xs text-muted-foreground'>{d.ip}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
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
