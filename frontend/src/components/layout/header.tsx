import { useEffect, useState } from 'react'
import { PanelLeftIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSidebar } from '@/components/ui/sidebar'
import { HeaderIconButton } from './header-icon-button'

type HeaderProps = React.HTMLAttributes<HTMLElement> & {
  fixed?: boolean
  ref?: React.Ref<HTMLElement>
}

export function Header({ className, fixed, children, ...props }: HeaderProps) {
  const [offset, setOffset] = useState(0)
  const { toggleSidebar } = useSidebar()

  useEffect(() => {
    const onScroll = () => {
      setOffset(document.body.scrollTop || document.documentElement.scrollTop)
    }

    // Add scroll listener to the body
    document.addEventListener('scroll', onScroll, { passive: true })

    // Clean up the event listener on unmount
    return () => document.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cn(
        'z-50 h-16',
        fixed && 'header-fixed peer/header sticky top-0 w-[inherit]',
        offset > 10 && fixed ? 'shadow' : 'shadow-none',
        className
      )}
      {...props}
    >
      <div
        className={cn(
          // px-0, не p-4: на телефоне 10 кнопок по 36px (см. header-icon-button.tsx) с gap-0 и без
          // разрыва между группами (убран ml-auto, см. page.tsx) заполняют ряд впритык край-в-край —
          // 10×36=360=ровно ширина экрана 360px, true slack = 0 (посчитано и перепроверено измерением).
          // justify-center: на ширинах >360px свободное место распределяется СИММЕТРИЧНО по краям
          // всего ряда, а не проваливается в один промежуток — на странице без headerCenter ml-auto
          // у правой группы (page.tsx) всё равно выталкивает её к правому краю (auto-margin потребляет
          // всё свободное место ДО того как сработает justify-content), так что здесь ничего не меняет.
          // Вертикальный отступ (py-4) не трогаем, он ни на что не влияет: кнопка уже выше отступа и
          // просто центрируется по всей высоте полосы (items-center)
          'relative flex h-full items-center justify-center gap-0 py-4 px-0',
          offset > 10 &&
            fixed &&
            'after:absolute after:inset-0 after:-z-10 after:bg-background/20 after:backdrop-blur-lg'
        )}
      >
        {/* не <SidebarTrigger> (он сам рендерит <Button>, чей базовый size-9 конфликтует с классами
            HeaderIconButton при слиянии) — тот же toggleSidebar(), но без второго источника размера */}
        <HeaderIconButton aria-label='Переключить боковую панель' onClick={toggleSidebar}>
          <PanelLeftIcon className='size-5' aria-hidden />
        </HeaderIconButton>
        {children}
      </div>
    </header>
  )
}
