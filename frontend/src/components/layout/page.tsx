import { useLocation } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ArrowUpDown, Check, Ellipsis } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConfigDrawer } from '@/components/config-drawer'
import { PanelRestartButton } from '@/components/panel-restart-button'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useViewMode } from '@/lib/view-mode'
import { ViewModeItems, ViewModeSwitch } from '@/components/view-mode-switch'
import { isTvSection } from '@/features/tv/sections'
import { LayoutEditContext } from './layout-edit'
import { useTheme } from '@/context/theme-provider'
import { sidebarData } from './data/sidebar-data'
import { Header } from './header'
import { Main } from './main'

type PageProps = {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  /** Идентификатор страницы с перетаскиваемыми блоками (SortableBlocks): в шапке появляется кнопка «Изменить порядок» */
  layoutPage?: string
}

// Общий каркас страницы раздела: шапка с поиском/темой + заголовок
// Иконка и цвет раздела — из sidebar-data по текущему адресу (одно место для сайдбара и заголовка)
function useSection() {
  const { pathname } = useLocation()
  for (const g of sidebarData.navGroups)
    for (const item of g.items) {
      if (!item.url) continue
      const url = String(item.url)
      if (url === '/' ? pathname === '/' : pathname === url || pathname.startsWith(url + '/')) return item
    }
  return null
}

export function Page({ title, description, actions, children, layoutPage }: PageProps) {
  const section = useSection()
  const [editing, setEditing] = useState(false)
  // Режим изменения порядка относится к конкретному набору блоков (например, к вкладке): при смене страницы/вкладки выключаем
  useEffect(() => setEditing(false), [layoutPage])
  const Icon = section?.icon
  // Обзор ставит свою кнопку; у разделов без ТВ-версии кнопка ведёт на общий /tv
  const slug = section?.url ? String(section.url).replace(/^\//, '') : ''
  // ТВ-версия: у раздела своя (/tv/<раздел>), у остальных — общий /tv; у Обзора — /tv
  const tvLink: { to: string; params?: Record<string, string> } = slug !== '' && isTvSection(slug) ? { to: '/tv/$section', params: { section: slug } } : { to: '/tv' }
  const { view } = useViewMode()
  const { theme, setTheme } = useTheme()
  const phone = view === 'phone'
  return (
    <>
      <Header fixed>
        {section?.url === '/media-control' && <PanelRestartButton />}
        <ConfigDrawer />
      </Header>
      <Main>
        <div className='mb-4 flex flex-wrap items-end justify-between gap-2'>
          <div className='flex min-w-0 flex-1 items-start justify-between gap-2 max-sm:basis-full'>
            <div className='min-w-0'>
              <h1 className='flex items-center gap-2 text-2xl font-bold tracking-tight'>
                {Icon && <Icon className={cn('size-6 shrink-0', section?.color)} aria-hidden='true' />}
                {title}
              </h1>
              {description && (
                <div className='text-muted-foreground'>{description}</div>
              )}
            </div>
            {/* Телефон: «⋯» стоит в строке заголовка, а не отдельной строкой под описанием */}
            {phone && (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant='outline' size='icon' aria-label='Ещё' className='shrink-0'>
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  {layoutPage && (
                    <>
                      <DropdownMenuItem onClick={() => setEditing(!editing)}>
                        {editing ? <Check /> : <ArrowUpDown />} {editing ? 'Готово' : 'Изменить порядок'}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem onClick={() => setTheme('light')}>
                    Светлая <Check size={14} className={cn('ms-auto', theme !== 'light' && 'hidden')} />
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme('dark')}>
                    Тёмная <Check size={14} className={cn('ms-auto', theme !== 'dark' && 'hidden')} />
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme('system')}>
                    Как в системе <Check size={14} className={cn('ms-auto', theme !== 'system' && 'hidden')} />
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <ViewModeItems tvLink={tvLink} />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <div className='flex flex-wrap items-center gap-2 empty:hidden'>
            {actions}
            {!phone && (
              <>
                {layoutPage && (
                  <Button variant={editing ? 'default' : 'outline'} size='sm' onClick={() => setEditing(!editing)} aria-pressed={editing}>
                    {editing ? <Check /> : <ArrowUpDown />} {editing ? 'Готово' : 'Изменить порядок'}
                  </Button>
                )}
                <ViewModeSwitch tvLink={tvLink} />
              </>
            )}
          </div>
        </div>
        {layoutPage ? <LayoutEditContext.Provider value={{ page: layoutPage, editing, setEditing }}>{children}</LayoutEditContext.Provider> : children}
      </Main>
    </>
  )
}
