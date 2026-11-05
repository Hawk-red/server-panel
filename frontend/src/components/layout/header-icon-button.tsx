import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean
}

// ЕДИНСТВЕННЫЙ источник размера/формы для всех иконок-кнопок в шапке (SidebarTrigger, иконки вкладок
// «Пульта», сортировка, переключатель вида, перезапуск панели, настройки). Любое визуальное отличие
// между этими кнопками — только через цвет иконки/обводки у вызывающего, НИКОГДА через размер/padding/
// radius здесь — иначе ряд снова расползается по пикселям, как в предыдущих попытках.
export const HeaderIconButton = forwardRef<HTMLButtonElement, Props>(
  ({ className, active, children, ...props }, ref) => (
    <button
      ref={ref}
      type='button'
      className={cn(
        // Телефон (<640px, где html[data-view='phone'] держит шапку на 3.5rem=52.5px при font-size:15px
        // там же — см. styles/index.css): h-[36px] явным пикселем, НЕ h-* в rem — тот же rem-перелом даёт
        // h-8 неожиданные 30px вместо 32 именно в этом режиме. 36px — абсолютный математический потолок
        // по ШИРИНЕ при px-0 на шапке (header.tsx) и gap-0 без разрыва между группами (page.tsx):
        // 10×36=360=ровно ширина экрана 360px, true slack = 0. sm:h-10/w-10 — от 640px, обычный rem, места много
        'flex h-[36px] w-[36px] sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg border',
        active ? 'border-ring bg-background' : 'border-border bg-muted/40 hover:bg-muted',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
)
HeaderIconButton.displayName = 'HeaderIconButton'
