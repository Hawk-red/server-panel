import { useLocation } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { ArrowUpDown, Check } from 'lucide-react'
import { ConfigDrawer } from '@/components/config-drawer'
import { PanelRestartButton } from '@/components/panel-restart-button'
import { ViewModeBar } from '@/components/view-mode-switch'
import { isTvSection } from '@/features/tv/sections'
import { cn } from '@/lib/utils'
import { HeaderIconButton } from './header-icon-button'
import { LayoutEditContext } from './layout-edit'
import { sidebarData } from './data/sidebar-data'
import { Header } from './header'
import { Main } from './main'

type PageProps = {
  title?: string
  description?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  /** Идентификатор страницы с перетаскиваемыми блоками (SortableBlocks): в шапке появляется кнопка «Изменить порядок» */
  layoutPage?: string
  /** Доп. содержимое в самой шапке, между кнопкой перезагрузки и правой группой (иконки вкладок «Пульта») */
  headerCenter?: React.ReactNode
}

// Общий каркас страницы раздела: шапка с поиском/темей + заголовок
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

export function Page({ title, description, actions, children, layoutPage, headerCenter }: PageProps) {
  const section = useSection()
  const [editing, setEditing] = useState(false)
  // Режим изменения порядка относится к конкретному набору блоков (например, к вкладке): при смене страницы/вкладки выключаем
  const prevLayoutPage = useRef(layoutPage)
  useEffect(() => {
    if (prevLayoutPage.current !== layoutPage) {
      setEditing(false)
      prevLayoutPage.current = layoutPage
    }
  }, [layoutPage])

  // Обзор ставит свою кнопку; у разделов без ТВ-версии кнопка ведёт на общий /tv
  const slug = section?.url ? String(section.url).replace(/^\//, '') : ''
  // ТВ-версия: у раздела своя (/tv/<раздел>), у остальных — общий /tv; у Обзора — /tv
  const tvLink: { to: string; params?: Record<string, string> } = slug !== '' && isTvSection(slug) ? { to: '/tv/$section', params: { section: slug } } : { to: '/tv' }
  // На «Пульте» видовая панель компактная: без «Авто» и «ТВ»
  const media = section?.url === '/media-control'

  const content = (
    <>
      <Header fixed>
        {/* overflow-x-auto — подстраховка на телефоне; gap здесь дела не меняет (один ребёнок — сам Tabs/TabsList,
            у него тот же gap-0, что и у шапки в целом и у правой группы, см. media-hub/index.tsx) */}
        {headerCenter && <div className='flex min-w-0 shrink items-center overflow-x-auto'>{headerCenter}</div>}
        {/* без ml-auto: если headerCenter есть (Медиа), группа идёт сразу за вкладками тем же gap-0 —
            единый плотный ряд без разрыва по центру. Если headerCenter нет (остальные страницы) —
            ml-auto нужен, иначе группа осталась бы у левого края рядом с кнопкой меню */}
        <div className={cn('flex shrink-0 items-center gap-0', !headerCenter && 'ml-auto')}>
          <ViewModeBar tvLink={tvLink} media={media} />
          <PanelRestartButton compact />
          {layoutPage && (
            <HeaderIconButton active={editing} aria-pressed={editing} aria-label={editing ? 'Готово' : 'Изменить порядок'} onClick={() => setEditing(!editing)}>
              {editing ? <Check className='size-5' /> : <ArrowUpDown className='size-5' />}
            </HeaderIconButton>
          )}
          <ConfigDrawer />
        </div>
      </Header>
      <Main compact={media}>
        {(title || description || actions) && (
          <div className='mb-4 flex flex-wrap items-end justify-between gap-2'>
            <div className='flex min-w-0 flex-1 items-start justify-between gap-2 max-sm:basis-full'>
              <div className='min-w-0'>
                {title && (
                  <h1 className='flex items-center justify-between gap-2 text-2xl font-bold tracking-tight'>
                    {title}
                  </h1>
                )}
                {description && (
                  <div className='text-muted-foreground'>{description}</div>
                )}
              </div>
            </div>
            <div className='flex flex-wrap items-center gap-2 empty:hidden'>
              {actions}
            </div>
          </div>
        )}
        {children}
      </Main>
    </>
  )

  // Провайдер оборачивает и шапку (headerCenter — иконки вкладок «Пульта» тоже перетаскиваемые
  // в режиме «Изменить порядок»), и основной контент — не только children, как раньше
  return layoutPage ? <LayoutEditContext.Provider value={{ page: layoutPage, editing, setEditing }}>{content}</LayoutEditContext.Provider> : content
}