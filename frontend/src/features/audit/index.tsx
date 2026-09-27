import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import { Page } from '@/components/layout/page'
import { NoData } from '@/components/no-data'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type Row = { id: number; ts: number; ip: string; user: string | null; action: string; target: string | null; details: unknown; result: 'ok' | 'error' | 'denied' }

// Человеческие названия действий
const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Вход в панель',
  'auth.logout': 'Выход из панели',
  'service.start': 'Запуск службы',
  'service.stop': 'Остановка службы',
  'service.restart': 'Перезапуск службы',
  'container.start': 'Запуск контейнера',
  'container.stop': 'Остановка контейнера',
  'container.restart': 'Перезапуск контейнера',
  'torrents.stop-all': 'Пауза всех торрентов',
  'torrents.start-all': 'Продолжить все торренты',
  'adguard.protection-off': 'AdGuard: защита выключена',
  'adguard.protection-on': 'AdGuard: защита включена',
  'disks.smart-refresh': 'Обновление SMART',
  'ssh-key.disable': 'Отключение SSH-ключа',
  'ssh-key.enable': 'Возврат SSH-ключа',
  'ufw.deny': 'Блокировка IP (ufw)',
  'ufw.undeny': 'Разблокировка IP (ufw)',
  'fail2ban.ban': 'Бан в fail2ban',
  'fail2ban.unban': 'Разбан в fail2ban',
  'session.kill': 'Завершение сессии',
  'ssh.stop': 'Отключение SSH',
  'ssh.start': 'Включение SSH',
  'network.discover': 'Сканирование сети',
  'network.port-scan': 'Сканирование портов',
  'network.device-update': 'Изменение устройства',
  'network.device-delete': 'Удаление устройства',
}
const label = (a: string) => ACTION_LABELS[a] ?? a
const RESULT: Record<Row['result'], { status: 'ok' | 'error' | 'warning'; text: string }> = {
  ok: { status: 'ok', text: 'успешно' },
  error: { status: 'error', text: 'ошибка' },
  denied: { status: 'warning', text: 'отказано' },
}
const PERIODS: Record<string, number> = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 }
const PAGE = 50

function describeDetails(d: unknown): string {
  if (!d || typeof d !== 'object') return ''
  const o = d as Record<string, unknown>
  if (o.reason === 'bad-password') return 'неверный пароль'
  if (o.reason === 'rate-limit') return 'превышен лимит попыток'
  return Object.entries(o)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(', ')
}

export function Audit() {
  const [action, setAction] = useState('all')
  const [result, setResult] = useState('all')
  const [period, setPeriod] = useState('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const facets = useQuery({
    queryKey: ['audit-facets'],
    queryFn: async () => (await api.get<{ actions: { action: string; n: number }[]; ips: { ip: string; n: number }[] }>('/audit/facets')).data,
  })
  const { data, isError } = useQuery({
    queryKey: ['audit', action, result, period, q, page],
    queryFn: async () =>
      (
        await api.get<{ total: number; rows: Row[] }>('/audit', {
          params: {
            limit: PAGE,
            offset: page * PAGE,
            action: action === 'all' ? undefined : action,
            result: result === 'all' ? undefined : result,
            from: period === 'all' ? undefined : Date.now() - PERIODS[period],
            q: q || undefined,
          },
        })
      ).data,
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  })
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE))
  const reset = () => setPage(0)

  return (
    <Page title='Журнал действий' description='Кто, когда, с какого IP и что сделал в панели (хранится год)'>
      <div className='mb-4 flex flex-wrap gap-2'>
        <Select value={action} onValueChange={(v) => (setAction(v), reset())}>
          <SelectTrigger className='w-56'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>Все действия</SelectItem>
            {facets.data?.actions.map((a) => (
              <SelectItem key={a.action} value={a.action}>
                {label(a.action)} ({a.n})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={result} onValueChange={(v) => (setResult(v), reset())}>
          <SelectTrigger className='w-40'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>Любой результат</SelectItem>
            <SelectItem value='ok'>успешно</SelectItem>
            <SelectItem value='error'>ошибка</SelectItem>
            <SelectItem value='denied'>отказано</SelectItem>
          </SelectContent>
        </Select>
        <Select value={period} onValueChange={(v) => (setPeriod(v), reset())}>
          <SelectTrigger className='w-36'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>За всё время</SelectItem>
            <SelectItem value='day'>Сутки</SelectItem>
            <SelectItem value='week'>Неделя</SelectItem>
            <SelectItem value='month'>Месяц</SelectItem>
          </SelectContent>
        </Select>
        <Input className='max-w-xs' placeholder='Поиск: цель, IP, подробности' value={q} onChange={(e) => (setQ(e.target.value), reset())} />
      </div>

      <Card className='py-0'>
        <CardContent className='p-0'>
          {isError ? (
            <div className='p-4'>
              <NoData reason='не удалось загрузить журнал' />
            </div>
          ) : (
            <div className='overflow-x-auto'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Когда</TableHead>
                    <TableHead>Действие</TableHead>
                    <TableHead className='hidden md:table-cell'>Цель</TableHead>
                    <TableHead className='hidden sm:table-cell'>IP</TableHead>
                    <TableHead className='hidden sm:table-cell'>Результат</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className='text-center text-muted-foreground'>
                        Записей нет
                      </TableCell>
                    </TableRow>
                  )}
                  {data?.rows.map((r) => (
                    <TableRow key={r.id} className='[&>td]:whitespace-normal'>
                      <TableCell className='align-top whitespace-nowrap tabular-nums'>
                        <span className='hidden sm:inline'>{new Date(r.ts).toLocaleString('ru-RU')}</span>
                        <span className='sm:hidden'>
                          {new Date(r.ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className='font-medium'>{label(r.action)}</div>
                        <div className='text-xs text-muted-foreground md:hidden'>{r.target}</div>
                        {r.details != null && <div className='text-xs break-words whitespace-normal text-muted-foreground'>{describeDetails(r.details)}</div>}
                        <StatusBadge className='mt-1 sm:hidden' status={RESULT[r.result].status} label={RESULT[r.result].text} />
                      </TableCell>
                      <TableCell className='hidden max-w-[20rem] truncate md:table-cell' title={r.target ?? undefined}>
                        {r.target ?? '—'}
                      </TableCell>
                      <TableCell className='hidden tabular-nums sm:table-cell'>{r.ip}</TableCell>
                      <TableCell className='hidden sm:table-cell'>
                        <StatusBadge status={RESULT[r.result].status} label={RESULT[r.result].text} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className='mt-3 flex items-center justify-between text-sm text-muted-foreground'>
        <span>Всего: {data?.total ?? '…'}</span>
        <div className='flex items-center gap-2'>
          <Button size='icon' variant='outline' disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label='Назад'>
            <ChevronLeft />
          </Button>
          <span className='tabular-nums'>
            {page + 1} / {pages}
          </span>
          <Button size='icon' variant='outline' disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} aria-label='Вперёд'>
            <ChevronRight />
          </Button>
        </div>
      </div>
    </Page>
  )
}
