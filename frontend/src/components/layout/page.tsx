import { useLocation } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { ConfigDrawer } from '@/components/config-drawer'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { sidebarData } from './data/sidebar-data'
import { Header } from './header'
import { Main } from './main'

type PageProps = {
  title: string
  description?: string
  actions?: React.ReactNode
  children?: React.ReactNode
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

export function Page({ title, description, actions, children }: PageProps) {
  const section = useSection()
  const Icon = section?.icon
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
          {actions}
        </div>
        {children}
      </Main>
    </>
  )
}
