import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { Pause, Play, RotateCw, ShieldCheck, ShieldOff, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { QuickState } from '@/features/infra-types'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { NoData } from '@/components/no-data'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Action = {
  id: string
  title: string
  desc: string
  confirmText: string
  run: () => Promise<unknown>
  done: string
}

const errMsg = (e: unknown) => (e instanceof AxiosError && e.response?.data?.message) || 'не удалось выполнить'

export function QuickActions() {
  const qc = useQueryClient()
  const [pending, setPending] = useState<Action | null>(null)
  const { data, isError } = useQuery({ queryKey: ['quick'], queryFn: async () => (await api.get<QuickState>('/quick')).data, refetchInterval: 10_000 })

  const exec = useMutation({
    mutationFn: (a: Action) => a.run(),
    onSuccess: (_r, a) => {
      toast.success(a.done)
      setPending(null)
      // состояние меняется не мгновенно — обновляем сразу и ещё раз чуть позже
      qc.invalidateQueries({ queryKey: ['quick'] })
      setTimeout(() => qc.invalidateQueries({ queryKey: ['quick'] }), 3000)
    },
    onError: (e) => {
      toast.error(errMsg(e))
      setPending(null)
    },
  })

  const torrents = data?.torrents.data
  const protection = data?.protection.data
  const container = data?.container.data
  const alertBot = data?.alertBot?.data
  const restartAction: Action = {
    id: 'restart-qbt',
    title: 'Перезапустить qBittorrent?',
    desc: 'Контейнер перезапустится за несколько секунд: активные закачки на это время прервутся и продолжатся сами.',
    confirmText: 'Перезапустить',
    run: () => api.post('/docker/containers/qbittorrent/restart', {}),
    done: 'qBittorrent перезапускается',
  }
  const pauseAction: Action = torrents?.allStopped
    ? { id: 'resume', title: 'Продолжить все торренты?', desc: 'Все торренты на паузе будут запущены.', confirmText: 'Продолжить', run: () => api.post('/torrents/start-all', {}), done: 'Торренты запущены' }
    : { id: 'pause', title: 'Поставить все торренты на паузу?', desc: 'Все закачки и раздачи будут остановлены до тех пор, пока вы их не продолжите.', confirmText: 'Поставить на паузу', run: () => api.post('/torrents/stop-all', {}), done: 'Торренты поставлены на паузу' }
  const alertBotAction: Action = {
    id: 'restart-alert-bot',
    title: 'Перезапустить бота Air Alert?',
    desc: 'Служба alert_monitor перезапустится за пару секунд. На это время бот не будет проверять тревоги, потом продолжит сам.',
    confirmText: 'Перезапустить',
    run: () => api.post('/system/services/alert_monitor.service/restart', {}),
    done: 'Бот Air Alert перезапускается',
  }
  const adguardOff = protection ? !protection.enabled : false
  const adguardAction: Action = adguardOff
    ? { id: 'ag-on', title: 'Включить защиту AdGuard сейчас?', desc: 'Блокировка рекламы и трекеров для всей сети снова заработает.', confirmText: 'Включить', run: () => api.post('/adguard/protection', { enabled: true }), done: 'Защита AdGuard включена' }
    : {
        id: 'ag-off',
        title: 'Выключить AdGuard на 10 минут?',
        desc: 'На 10 минут перестанут блокироваться реклама и трекеры во всей сети (DNS продолжит работать). Потом защита включится сама.',
        confirmText: 'Выключить на 10 минут',
        run: () => api.post('/adguard/protection', { enabled: false, minutes: 10 }),
        done: 'AdGuard выключен на 10 минут',
      }

  const rows: { key: string; icon: React.ElementType; label: string; state: React.ReactNode; button: string; ButtonIcon: React.ElementType; action: Action; disabled: boolean }[] = [
    {
      key: 'qbt',
      icon: RotateCw,
      label: 'qBittorrent',
      state: container ? (container.state === 'running' ? 'контейнер работает' : `контейнер: ${container.state}`) : <NoData reason={data?.container.error} />,
      button: 'Перезапустить',
      ButtonIcon: RotateCw,
      action: restartAction,
      disabled: !container,
    },
    {
      key: 'alert-bot',
      icon: RotateCw,
      label: 'Бот Air Alert',
      state: alertBot ? (alertBot.active === 'active' ? 'служба работает' : <span className='text-danger-foreground'>служба: {alertBot.active}</span>) : <NoData reason={data?.alertBot?.error} />,
      button: 'Перезапустить бота',
      ButtonIcon: RotateCw,
      action: alertBotAction,
      disabled: !alertBot,
    },
    {
      key: 'torrents',
      icon: Pause,
      label: 'Торренты',
      state: torrents ? (torrents.total === 0 ? 'торрентов нет' : torrents.allStopped ? `все на паузе (${torrents.total})` : `${torrents.running} из ${torrents.total} работают`) : <NoData reason={data?.torrents.error} />,
      button: torrents?.allStopped ? 'Продолжить' : 'Пауза',
      ButtonIcon: torrents?.allStopped ? Play : Pause,
      action: pauseAction,
      disabled: !torrents || torrents.total === 0,
    },
    {
      key: 'adguard',
      icon: ShieldCheck,
      label: 'AdGuard Home',
      state: protection ? (
        adguardOff ? (
          <span className='text-warn-foreground'>защита выключена{protection.disabledLeftSec ? `, ещё ${Math.max(1, Math.ceil(protection.disabledLeftSec / 60))} мин` : ''}</span>
        ) : (
          'защита включена'
        )
      ) : (
        <NoData reason={data?.protection.error} />
      ),
      button: adguardOff ? 'Включить' : 'Выключить на 10 мин',
      ButtonIcon: adguardOff ? ShieldCheck : ShieldOff,
      action: adguardAction,
      disabled: !protection,
    },
  ]

  return (
    <Card className='gap-2'>
      <CardHeader>
        <CardTitle className='flex items-center gap-2 text-sm font-medium'>
          <Zap className='size-4 text-brand' aria-hidden='true' /> Быстрые действия
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isError ? (
          <NoData reason='бэкенд не ответил' />
        ) : (
          <ul className='divide-y'>
            {rows.map((r) => (
              <li key={r.key} className='flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5'>
                <div className='min-w-0'>
                  <div className='text-sm font-medium'>{r.label}</div>
                  <div className='text-xs text-muted-foreground'>{r.state}</div>
                </div>
                <Button size='sm' variant='outline' disabled={r.disabled || exec.isPending} onClick={() => setPending(r.action)}>
                  <r.ButtonIcon /> {r.button}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {pending && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={pending.title}
          desc={pending.desc}
          confirmText={pending.confirmText}
          isLoading={exec.isPending}
          handleConfirm={() => exec.mutate(pending)}
        />
      )}
    </Card>
  )
}
