import { Link, useLocation } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ArrowUpDown, Check, Tv } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConfigDrawer } from '@/components/config-drawer'
import { Search } from '@/components/search'
import { Button } from '@/components/ui/button'
import { isTvSection } from '@/features/tv/sections'
import { LayoutEditContext } from './layout-edit'
import { ThemeSwitch } from '@/components/theme-switch'
import { sidebarData } from './data/sidebar-data'
import { Header } from './header'
import { Main } from './main'

type PageProps = {
  title: string
  description?: string
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
  const tvLink = !section || slug === '' ? null : isTvSection(slug) ? { to: '/tv/$section' as const, params: { section: slug } } : { to: '/tv' as const, params: {} }
  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
      </Header>
      <Main>
        <div className='mb-4 flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h1 className='flex items-center gap-2 text-2xl font-bold tracking-tight'>
              {Icon && <Icon className={cn('size-6 shrink-0', section?.color)} aria-hidden='true' />}
              {title}
            </h1>
            {description && (
              <p className='text-muted-foreground'>{description}</p>
            )}
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            {actions}
            {layoutPage && (
              <Button variant={editing ? 'default' : 'outline'} size='sm' onClick={() => setEditing(!editing)} aria-pressed={editing}>
                {editing ? <Check /> : <ArrowUpDown />} {editing ? 'Готово' : 'Изменить порядок'}
              </Button>
            )}
            {tvLink && (
              <Button variant='outline' size='sm' asChild>
                <Link to={tvLink.to} params={tvLink.params as never}>
                  <Tv /> Режим ТВ
                </Link>
              </Button>
            )}
          </div>
        </div>
        {layoutPage ? <LayoutEditContext.Provider value={{ page: layoutPage, editing, setEditing }}>{children}</LayoutEditContext.Provider> : children}
      </Main>
    </>
  )
}
