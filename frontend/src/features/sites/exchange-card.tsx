import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, ExternalLink, FolderUp, Settings2 } from 'lucide-react'
import { api } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import { formatDateTime } from '@/lib/format'
import type { ExchangeState } from '@/features/infra-types'
import { Meter } from '@/components/meter'
import { NoData } from '@/components/no-data'
import { StatusBadge } from '@/components/status-badge'
import { Value } from '@/components/value'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function LinkRow({ label, url, hint }: { label: string; url: string; hint: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5'>
      <div className='min-w-0'>
        <div className='text-sm font-medium'>{label}</div>
        <div className='text-xs text-muted-foreground'>{hint}</div>
        <a href={url} target='_blank' rel='noreferrer' className='font-mono text-xs break-all text-address hover:underline'>
          {url}
        </a>
      </div>
      <div className='flex shrink-0 gap-1'>
        <Button
          size='sm'
          variant='outline'
          onClick={async () => {
            if (await copyText(url)) {
              setDone(true)
              setTimeout(() => setDone(false), 1500)
            }
          }}
        >
          {done ? <Check /> : <Copy />} {done ? 'Скопировано' : 'Копировать'}
        </Button>
        <Button size='sm' variant='outline' asChild>
          <a href={url} target='_blank' rel='noreferrer'>
            <ExternalLink /> Открыть
          </a>
        </Button>
      </div>
    </div>
  )
}

export function ExchangeCard() {
  const { data, isError } = useQuery({ queryKey: ['exchange'], queryFn: async () => (await api.get<ExchangeState>('/exchange')).data, refetchInterval: 30_000 })
  const running = data?.container?.state === 'running'
  const status = !data ? null : !data.installed ? 'unknown' : running && data.health?.ok ? 'ok' : running ? 'warning' : 'error'
  const label = !data ? '' : !data.installed ? 'не установлен' : running && data.health?.ok ? `работает · ответ за ${data.health.ms} мс` : running ? 'запущен, но не отвечает' : `контейнер: ${data.container?.state}`
  return (
    <Card id='exchange' className='gap-3'>
      <CardHeader className='flex flex-row flex-wrap items-start gap-x-3 gap-y-2'>
        <FolderUp className='size-9 shrink-0 text-indigo' aria-hidden='true' />
        <div className='min-w-0 flex-1'>
          <CardTitle className='text-base'>Обменник файлов (SFTPGo)</CardTitle>
          <p className='text-xs text-muted-foreground'>Docker sftpgo · /srv/exchange · за nginx на api.pulsdev.net, путь /files/</p>
        </div>
        <div className='w-full ps-12 sm:w-auto sm:ps-0'>{status ? <StatusBadge status={status} label={label} /> : <NoData />}</div>
      </CardHeader>
      <CardContent className='space-y-4 text-sm'>
        {isError ? (
          <NoData reason='бэкенд не ответил' />
        ) : !data ? (
          <span className='text-muted-foreground'>Загрузка…</span>
        ) : !data.installed ? (
          <p className='text-muted-foreground'>Контейнер sftpgo не найден. Установка: sudo /opt/server-panel/deploy/exchange/install.sh</p>
        ) : (
          <>
            <div className='divide-y'>
              <LinkRow label='Снаружи (для гостей)' url={data.urls.external} hint='порт 9443 на роутере → 443 сервера' />
              <LinkRow label='Из дома' url={data.urls.home} hint='нужна запись в AdGuard: api.pulsdev.net → 192.168.31.112' />
              <LinkRow label='Админка (пользователи, папки, права)' url={data.urls.admin} hint='только из домашней сети и VPN' />
            </div>

            <div className='space-y-2'>
              <div className='text-xs font-medium text-muted-foreground'>Место</div>
              {data.disk ? (
                <>
                  <div className='flex flex-wrap items-baseline justify-between gap-x-3'>
                    <span>
                      Обменник занимает {data.disk.exchangeBytes != null ? <Value kind='bytes' value={data.disk.exchangeBytes} /> : <span className='text-muted-foreground'>считается…</span>}
                      {data.disk.uploadsBytes != null && (
                        <span className='text-muted-foreground'>
                          {' '}
                          · гостевые загрузки <Value kind='bytes' value={data.disk.uploadsBytes} />
                        </span>
                      )}
                    </span>
                    {data.disk.fs && (
                      <span className='text-muted-foreground'>
                        на диске свободно <Value kind='bytes' value={data.disk.fs.free} /> из <Value kind='bytes' value={data.disk.fs.total} />
                      </span>
                    )}
                  </div>
                  {data.disk.fs && <Meter value={data.disk.fs.percent} direction='higher-worse' label='Диск обменника' />}
                  <p className='text-xs text-muted-foreground'>Обменник лежит на системном SSD. Предел для гостя (квота и размер файла) задаётся в админке.</p>
                </>
              ) : (
                <NoData reason='каталог /srv/exchange не найден' />
              )}
            </div>

            <div>
              <div className='mb-1 text-xs font-medium text-muted-foreground'>Последние загрузки</div>
              {data.recent.length === 0 ? (
                <p className='text-muted-foreground'>Загрузок пока не было (панель считает с момента запуска контейнера).</p>
              ) : (
                <ul className='divide-y'>
                  {data.recent.map((u, i) => (
                    <li key={i} className='flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5'>
                      <span className='min-w-0'>
                        <span className='font-medium break-all'>{u.name}</span>
                        <span className='ms-2 text-xs text-muted-foreground'>{u.user === data.guest ? 'гость' : `пользователь ${u.user}`}</span>
                      </span>
                      <span className='shrink-0 text-xs text-muted-foreground'>
                        <Value kind='bytes' value={u.size} /> · <span className='font-mono text-address'>{u.ip || '?'}</span> · {formatDateTime(u.ts)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className='flex items-center gap-1.5 text-xs text-muted-foreground'>
              <Settings2 className='size-3.5 shrink-0' /> О загрузках гостя приходит уведомление в Telegram (имя, размер, IP). Правило «обменник» включается на странице «Уведомления».
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
