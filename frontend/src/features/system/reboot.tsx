import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { Eye, EyeOff, Power, TriangleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Ожидание возврата панели после перезагрузки: опрашиваем /api/health, когда ответил — перезагружаем страницу
function RebootingOverlay() {
  const [since] = useState(() => Date.now())
  const [secs, setSecs] = useState(0)
  const { isError, isSuccess } = useQuery({
    queryKey: ['reboot-wait'],
    queryFn: async () => (await api.get('/health', { timeout: 4000 })).data,
    refetchInterval: 4000,
    retry: false,
  })
  useEffect(() => {
    const t = setInterval(() => setSecs(Math.floor((Date.now() - since) / 1000)), 1000)
    return () => clearInterval(t)
  }, [since])
  // Панель была недоступна, потом снова ответила — значит сервер поднялся
  const wentDown = useRef(false)
  useEffect(() => {
    if (isError) wentDown.current = true
    if (isSuccess && wentDown.current) window.location.reload()
  }, [isError, isSuccess])
  return (
    <div className='fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-background/95 p-6 text-center'>
      <Power className='size-10 animate-pulse text-warn-foreground' />
      <div className='text-lg font-semibold'>Сервер перезагружается</div>
      <p className='max-w-sm text-sm text-muted-foreground'>
        Обычно это 1–3 минуты. Docker-контейнеры поднимутся сами, панель вернётся автоматически. Если вы подключены по VPN или SSH, соединение прервётся.
      </p>
      <div className='text-xs text-muted-foreground tabular-nums'>
        прошло {secs} с · {isError ? 'панель пока не отвечает, жду' : 'жду начала перезагрузки'}
      </div>
    </div>
  )
}

// Кнопка «Перезагрузить сервер»: диалог с предупреждением и вводом пароля панели прямо в диалоге
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
          <Button size='sm' variant='destructive'>
            <Power /> Перезагрузить сервер
          </Button>
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
      {rebooting && <RebootingOverlay />}
    </>
  )
}
