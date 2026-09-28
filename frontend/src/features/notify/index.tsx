import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { BellRing, CheckCircle2, Moon, Save, Search, Send } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { Page } from '@/components/layout/page'
import { NoData } from '@/components/no-data'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

type RuleId = 'unit' | 'disk' | 'temp' | 'device' | 'cert' | 'sync' | 'internet' | 'backup' | 'deadline'
type Settings = { chatId: number | null; enabled: boolean; quiet: { from: string; to: string }; rules: Record<RuleId, boolean> }
type Status = {
  tokenSet: boolean
  tokenConflict: string | null
  bot: { username: string; first_name: string } | null
  settings: Settings
  rules: Record<RuleId, { title: string; urgent: string }>
  quietNow: boolean
  queued: number
  sent: { ts: number; text: string; ok: boolean; urgent: boolean; error?: string }[]
}
type Chat = { id: number; name: string; type: string; last: number; text: string }

const errMsg = (e: unknown) => (e instanceof AxiosError && e.response?.data?.message) || 'ошибка'

export function Notifications() {
  const qc = useQueryClient()
  const { data, isError } = useQuery({ queryKey: ['notify'], queryFn: async () => (await api.get<Status>('/notify')).data, refetchInterval: 30_000 })
  const [form, setForm] = useState<Settings | null>(null)
  const [chats, setChats] = useState<Chat[] | null>(null)
  useEffect(() => {
    if (data && !form) setForm(data.settings)
  }, [data, form])

  const save = useMutation({
    mutationFn: (s: Settings) => api.put('/notify', s),
    onSuccess: () => {
      toast.success('Настройки уведомлений сохранены')
      qc.invalidateQueries({ queryKey: ['notify'] })
    },
    onError: (e) => toast.error(errMsg(e)),
  })
  const detect = useMutation({
    mutationFn: async () => (await api.post<Chat[]>('/notify/detect-chat', {})).data,
    onSuccess: (c) => {
      setChats(c)
      if (!c.length) toast.info('Боту ещё никто не писал — отправьте ему /start и нажмите ещё раз')
    },
    onError: (e) => toast.error(errMsg(e)),
  })
  const test = useMutation({
    mutationFn: () => api.post('/notify/test', {}),
    onSuccess: () => {
      toast.success('Тестовое сообщение отправлено — проверьте Telegram')
      qc.invalidateQueries({ queryKey: ['notify'] })
    },
    onError: (e) => toast.error(errMsg(e)),
  })

  const pickChat = (id: number) => {
    if (!form) return
    const next = { ...form, chatId: id }
    setForm(next)
    save.mutate(next)
    setChats(null)
  }

  return (
    <Page title='Уведомления' description='Telegram-бот панели: события сервера приходят сообщениями'>
      {isError && <NoData reason='не удалось получить настройки' />}
      {data && form && (
        <div className='grid items-start gap-4 lg:grid-cols-2'>
          <Card className='gap-3'>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-base'>
                <BellRing className='size-5 text-brand' /> Подключение
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-4 text-sm'>
              <ol className='space-y-3'>
                <li className='flex gap-2'>
                  <span className='font-medium'>1.</span>
                  <div>
                    Токен бота:{' '}
                    {data.tokenConflict ? (
                      <StatusBadge status='error' label={`совпадает с ботом «${data.tokenConflict}»`} />
                    ) : data.tokenSet ? (
                      <StatusBadge status='ok' label={data.bot ? `задан — @${data.bot.username}` : 'задан, но Telegram не ответил'} />
                    ) : (
                      <StatusBadge status='warning' label='не задан' />
                    )}
                    {data.tokenConflict && (
                      <p className='mt-1 text-xs text-danger'>
                        Это токен рабочего бота — панель не будет им пользоваться, чтобы не мешать ему. Создайте отдельного бота в @BotFather и задайте его токен командой ниже.
                      </p>
                    )}
                    {(!data.tokenSet || data.tokenConflict) && (
                      <p className='mt-1 text-xs text-muted-foreground'>
                        В SSH-терминале: <code className='font-mono text-address'>sudo -u panel node /opt/server-panel/backend/dist/scripts/set-secret.js NOTIFY_BOT_TOKEN</code>,
                        затем <code className='font-mono text-address'>sudo systemctl restart server-panel</code>.
                      </p>
                    )}
                  </div>
                </li>
                <li className='flex gap-2'>
                  <span className='font-medium'>2.</span>
                  <div className='space-y-2'>
                    <div>
                      Напишите боту {data.bot ? <a className='text-info underline' href={`https://t.me/${data.bot.username}`} target='_blank' rel='noreferrer'>@{data.bot.username}</a> : 'в Telegram'} любое сообщение
                      (например, /start) и нажмите «Найти чат».
                    </div>
                    <div className='flex flex-wrap items-center gap-2'>
                      <Button size='sm' variant='outline' onClick={() => detect.mutate()} disabled={!data.tokenSet || detect.isPending}>
                        <Search /> Найти чат
                      </Button>
                      <span className='text-xs text-muted-foreground'>
                        Выбран: {form.chatId ? <span className='font-mono text-address'>{form.chatId}</span> : 'нет'}
                      </span>
                    </div>
                    {chats && chats.length > 0 && (
                      <ul className='space-y-1'>
                        {chats.map((c) => (
                          <li key={c.id} className='flex items-center justify-between gap-2 rounded border px-2 py-1'>
                            <span className='min-w-0 truncate'>
                              {c.name || c.type} <span className='font-mono text-xs text-address'>{c.id}</span>
                              {c.text && <span className='text-xs text-muted-foreground'> · «{c.text}»</span>}
                            </span>
                            <Button size='sm' onClick={() => pickChat(c.id)}>
                              <CheckCircle2 /> Это я
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
                <li className='flex gap-2'>
                  <span className='font-medium'>3.</span>
                  <div className='flex flex-wrap items-center gap-2'>
                    <Button size='sm' onClick={() => test.mutate()} disabled={!form.chatId || test.isPending}>
                      <Send /> Отправить тест
                    </Button>
                  </div>
                </li>
              </ol>
              <label className='flex items-center gap-2 border-t pt-3'>
                <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} /> Уведомления включены
              </label>
            </CardContent>
          </Card>

          <Card className='gap-3'>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-base'>
                <Moon className='size-5 text-time' /> Тихие часы и правила
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-4 text-sm'>
              <div className='flex flex-wrap items-center gap-2'>
                <span>Тихо с</span>
                <Input className='w-20 text-center font-mono' inputMode='numeric' maxLength={5} placeholder='ЧЧ:ММ' aria-label='начало тихих часов' value={form.quiet.from} onChange={(e) => setForm({ ...form, quiet: { ...form.quiet, from: e.target.value.replace(/[^\d:]/g, '') } })} />
                <span>до</span>
                <Input className='w-20 text-center font-mono' inputMode='numeric' maxLength={5} placeholder='ЧЧ:ММ' aria-label='конец тихих часов' value={form.quiet.to} onChange={(e) => setForm({ ...form, quiet: { ...form.quiet, to: e.target.value.replace(/[^\d:]/g, '') } })} />
                {data.quietNow && <StatusBadge status='unknown' label={`сейчас тихие часы · в очереди ${data.queued}`} />}
              </div>
              <p className='text-xs text-muted-foreground'>В тихие часы обычные уведомления копятся и приходят одной сводкой в конце. «Всегда» — приходят сразу.</p>
              <ul className='space-y-2'>
                {(Object.keys(data.rules) as RuleId[]).map((id) => (
                  <li key={id} className='flex items-start gap-3'>
                    <Switch checked={form.rules[id]} onCheckedChange={(v) => setForm({ ...form, rules: { ...form.rules, [id]: v } })} aria-label={data.rules[id].title} />
                    <div>
                      <div>{data.rules[id].title}</div>
                      {data.rules[id].urgent && <div className='text-xs text-danger-foreground'>{data.rules[id].urgent}</div>}
                    </div>
                  </li>
                ))}
              </ul>
              <p className='text-xs text-muted-foreground'>
                Без дублей: каждое условие сообщается один раз при переходе порога; повтор — только после возврата ниже порога с запасом.
              </p>
              <Button onClick={() => save.mutate(form)} disabled={save.isPending || !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.quiet.from) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.quiet.to)}>
                <Save /> Сохранить
              </Button>
            </CardContent>
          </Card>

          <Card className='gap-2 lg:col-span-2'>
            <CardHeader>
              <CardTitle className='text-sm font-medium'>Последние уведомления</CardTitle>
            </CardHeader>
            <CardContent className='space-y-1 text-sm'>
              {data.sent.length === 0 ? (
                <span className='text-muted-foreground'>Пока ничего не отправлялось.</span>
              ) : (
                data.sent.map((s, i) => (
                  <div key={i} className='flex flex-wrap items-start gap-2'>
                    <span className='text-xs text-time tabular-nums'>{formatDateTime(s.ts)}</span>
                    <StatusBadge status={s.ok ? 'ok' : 'error'} label={s.ok ? (s.urgent ? 'отправлено, срочно' : 'отправлено') : `ошибка: ${s.error}`} className='text-xs' />
                    <span className='min-w-0 flex-1'>{s.text.replace(/<[^>]+>/g, '')}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </Page>
  )
}
