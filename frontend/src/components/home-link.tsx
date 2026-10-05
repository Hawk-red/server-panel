import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { HOME_ONLY_HINT, useLinks } from '@/lib/links'

type HomeLinkProps = Omit<React.ComponentProps<'a'>, 'href'> & {
  /** id службы из реестра (/api/links): адрес берётся с сервера */
  service?: string
  /** путь вместо пути службы по умолчанию (например, глубокая ссылка в Portainer) */
  path?: string
  /** готовый адрес (устройство в LAN и т. п.): ссылка активна только изнутри */
  href?: string
  /** false — в этой же вкладке (rdp://, vnc://) */
  newTab?: boolean
}

// Ссылка на то, что открывается только из дома / по WireGuard. Изнутри — обычная ссылка (новая вкладка), снаружи — неактивная
// с подсказкой (на телефоне подсказка показывается по нажатию). Подходит и для <Button asChild>.
export function HomeLink({ service, path, href, newTab = true, className, children, onClick, ...rest }: HomeLinkProps) {
  const links = useLinks()
  const target = service ? links.href(service, path) : links.internal === false ? null : (href ?? null)
  if (target) {
    return (
      <a href={target} target={newTab ? '_blank' : undefined} rel='noreferrer' className={className} onClick={onClick} {...rest}>
        {children}
      </a>
    )
  }
  const loading = !links.loaded
  return (
    <span
      {...(rest as React.ComponentProps<'span'>)}
      role='link'
      aria-disabled='true'
      title={loading ? undefined : HOME_ONLY_HINT}
      className={cn(className, 'cursor-not-allowed opacity-50 no-underline hover:no-underline')}
      onClick={(e) => {
        e.preventDefault()
        if (!loading) toast.info(HOME_ONLY_HINT)
      }}
    >
      {children}
    </span>
  )
}
