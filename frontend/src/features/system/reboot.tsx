import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { Eye, EyeOff, Power, RotateCw, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SidebarMenuButton } from '@/components/ui/sidebar'

// Ожидание возврата панели (после перезагрузки сервера или перезапуска службы): опрашиваем /api/health,
// когда панель была недоступна и снова ответила — перезагружаем страницу.
// fallbackSec — для короткого перезапуска службы: если падения не поймали, через столько секунд живой ответ тоже означает возврат.
export function WaitOverlay({ title, hint, pollMs = 4000, fallbackSec }: { title: string; hint: string; pollMs?: number; fallbackSec?: number }) {
  const [since] = useState(() => Date.now())
  const [secs, setSecs] = useState(0)
  const { isError, isSuccess, dataUpdatedAt } = useQuery({
    queryKey: ['reboot-wait'],
    queryFn: async () => (await api.get('/health', { timeout: 4000 })).data,
    refetchInterval: pollMs,
    retry: false,
  })
  useEffect(() => {
    const t = setInterval(() => setSecs(Math.floor((Date.now() - since) / 1000)), 1000)
    return () => clearInterval(t)
  }, [since])
  const wentDown = useRef(false)
  useEffect(() => {
    if (isError) wentDown.current = true
    const elapsed = (Date.now() - since) / 1000
    if (isSuccess && (wentDown.current || (fallbackSec != null && elapsed >= fallbackSec))) window.location.reload()
  }, [isError, isSuccess, dataUpdatedAt, since, fallbackSec])
  // Через портал в body: оверлей не зависит от того, где стоит кнопка (сайдбар, мобильная шторка)
  return createPortal(
    <div className='fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-background/95 p-6 text-center'>
      <Power className='size-10 animate-pulse text-warn-foreground' />
      <div className='text-lg font-semibold'>{title}</div>
      <p className='max-w-sm text-sm text-muted-foreground'>{hint}</p>
      <div className='text-xs text-muted-foreground tabular-nums'>
        прошло {secs} с · {isError ? 'панель пока не отвечает, жду' : 'жду начала перезагрузки'}
      </div>
    </div>,
    document.body
  )
}

// Перезапуск панели: спокойная кнопка (нейтральная, не красная). Подтверждение без пароля — действие лёгкое.
export function PanelRestartButton() {
  const [open, setOpen] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const restart = useMutation({
    mutationFn: async () => (await api.post('/system/panel/restart', {}, { timeout: 10_000 })).data,
    onSuccess: () => {
      setOpen(false)
      setRestarting(true)
    },
    onError: (e) => {
      setOpen(false)
      toast.error((e instanceof AxiosError && e.response?.data?.message) || 'не удалось перезапустить панель')
    },
  })
  return (
    <>
      <SidebarMenuButton tooltip='Перезапустить панель' onClick={() => setOpen(true)}>
        <RotateCw />
        <span>Перезапустить панель</span>
      </SidebarMenuButton>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => !restart.isPending && setOpen(o)}
        title='Перезапустить панель?'
        desc='Панель перезапустится, страница на пару секунд потеряет связь и вернётся сама.'
        confirmText='Перезапустить'
        isLoading={restart.isPending}
        handleConfirm={() => restart.mutate()}
      />
      {restarting && <WaitOverlay title='Панель перезапускается' hint='Обычно это несколько секунд. Страница вернётся сама.' pollMs={1000} fallbackSec={6} />}
    </>
  )
}

// Кнопка «Перезагрузить сервер»: диалог с предупреждением и вводом пароля панели прямо в диалоге.
// Живёт внизу сайдбара (пункт меню, красным) — отдельно от действий раздела, чтобы её не нажали по ошибке.
export function RebootButton() {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rebooting, setRebooting] = useState(false)

  const reboot = useMutation({
    mutationFn: async () => (await api.post('/system/reboot', { password }, { timeout: 15_000 })).data,
    onSuccess: () => {
      setOpen(false)
      setPassword('')
      setRebooting(true)
    },
    onError: (e) => {
      setError((e instanceof AxiosError && e.response?.data?.message) || 'не удалось запустить перезагрузку')
      setPassword('')
    },
  })

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (reboot.isPending) return
          setOpen(o)
          if (!o) {
            setPassword('')
            setError(null)
            setShow(false)
          }
        }}
      >
        <DialogTrigger asChild>
          <SidebarMenuButton tooltip='Перезагрузить сервер' className='text-danger-foreground hover:bg-danger/10 hover:text-danger-foreground'>
            <Power />
            <span>Перезагрузить сервер</span>
          </SidebarMenuButton>
        </DialogTrigger>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <TriangleAlert className='size-5 text-danger-foreground' /> Перезагрузить сервер?
            </DialogTitle>
            <DialogDescription asChild>
              <div className='space-y-2 text-sm'>
                <p>Вы подключены удалённо. Сервер уйдёт на 1–3 минуты: Docker-контейнеры поднимутся сами, панель вернётся автоматически.</p>
                <p className='text-warn-foreground'>Если сервер не поднимется, включить его удалённо нельзя: понадобится физический доступ.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <form
            className='space-y-3'
            onSubmit={(e) => {
              e.preventDefault()
              if (password) reboot.mutate()
            }}
          >
            <Label htmlFor='reboot-password'>Пароль панели</Label>
            <div className='relative'>
              <Input id='reboot-password' type={show ? 'text' : 'password'} autoComplete='off' value={password} onChange={(e) => setPassword(e.target.value)} autoFocus className='pr-10' />
              <button type='button' onClick={() => setShow(!show)} className='absolute inset-y-0 right-2 flex items-center text-muted-foreground' aria-label={show ? 'скрыть пароль' : 'показать пароль'}>
                {show ? <EyeOff className='size-4' /> : <Eye className='size-4' />}
              </button>
            </div>
            {error && <p className='text-sm text-danger-foreground'>{error}</p>}
            <DialogFooter>
              <Button type='button' variant='outline' onClick={() => setOpen(false)} disabled={reboot.isPending}>
                Отмена
              </Button>
              <Button type='submit' variant='destructive' disabled={!password || reboot.isPending}>
                {reboot.isPending ? 'Отправляю…' : 'Перезагрузить'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {rebooting && <WaitOverlay title='Сервер перезагружается' hint='Обычно это 1–3 минуты. Docker-контейнеры поднимутся сами, панель вернётся автоматически. Если вы подключены по VPN или SSH, соединение прервётся.' />}
    </>
  )
}
