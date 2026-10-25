import { cn } from '@/lib/utils'
import type { KeyStatus } from '@/lib/receiver-pad'
import { buzz, useHoldButton } from './use-hold'

// Общая кнопка экранных пультов (ресивер, телевизор): вдавливание, вибрация, удержание с автоповтором, режим настройки.
export const KEY =
  'relative flex min-w-0 select-none items-center justify-center bg-gradient-to-b from-zinc-600 to-zinc-800 text-center font-semibold uppercase leading-tight tracking-wide text-zinc-100 ' +
  'shadow-[0_2px_0_0_#000,0_4px_5px_rgba(0,0,0,.55),inset_0_1px_0_rgba(255,255,255,.16)] transition-[transform,box-shadow,opacity] duration-75 ' +
  'active:translate-y-[2px] active:shadow-[0_0_0_0_#000,inset_0_2px_6px_rgba(0,0,0,.75)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400'

export type BaseKeyProps = {
  id: string
  label: string // подпись для скринридера и подсказки
  cmd: string | null // команда/ключ, привязанные к кнопке
  status: KeyStatus
  custom: boolean // привязка отличается от умолчания
  cmdTitle: string // название привязанной команды (подсказка в режиме настройки)
  repeatable: boolean // удержание повторяет команду
  configure: boolean
  onPress: (id: string, cmd: string) => void
  onPick: (id: string) => void
  className?: string
  active?: boolean
  children: React.ReactNode
}

export function BasePadKey({ id, label, cmd, status, custom, cmdTitle, repeatable, configure, onPress, onPick, className, active, children }: BaseKeyProps) {
  const live = configure ? true : status.enabled
  const repeat = !configure && live && repeatable
  const fire = () => {
    if (cmd) onPress(id, cmd)
  }
  const hold = useHoldButton(fire)
  const title = configure ? `${label}: ${cmdTitle}` : status.enabled ? label : `${label} — ${status.reason}`
  return (
    <button
      type='button'
      data-key={id}
      data-command={cmd ?? ''}
      data-state={configure ? 'configure' : status.enabled ? 'on' : 'off'}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      aria-disabled={!live}
      title={title}
      className={cn(KEY, !live && 'cursor-not-allowed opacity-40', configure && 'outline-dashed outline-2 outline-offset-2 outline-sky-400/80', className)}
      style={{ touchAction: 'manipulation' }}
      {...(repeat ? hold : {})}
      onClick={
        repeat
          ? undefined
          : () => {
              if (configure) return onPick(id)
              if (!status.enabled) return
              buzz()
              fire()
            }
      }
    >
      {children}
      {configure && custom && <span aria-hidden className='absolute -right-1 -top-1 size-2.5 rounded-full bg-amber-400 ring-2 ring-zinc-900' />}
      {!configure && active && <span aria-hidden className='absolute right-1 top-1 size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]' />}
    </button>
  )
}

export const Cap = ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={cn('mb-1 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-400', className)}>{children}</div>
