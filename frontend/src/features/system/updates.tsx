import { useQuery } from '@tanstack/react-query'
import { ClipboardCopy, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import { formatRelative } from '@/lib/format'
import type { UpdatesSnapshot } from '@/lib/types'
import { NoData } from '@/components/no-data'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const shortDigest = (d: string | null) => (d ? d.replace(/^sha256:/, '').slice(0, 12) : '—')

function CopyCommand({ cmd }: { cmd: string }) {
  return (
    <div className='flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2'>
      <code className='flex-1 overflow-x-auto font-mono text-xs whitespace-nowrap'>{cmd}</code>
      <Button
        size='icon'
        variant='ghost'
        className='size-6 shrink-0'
        onClick={async () => (await copyText(cmd)) ? toast.success('Скопировано') : toast.error('Не удалось скопировать')}
        title='Скопировать команду'
      >
        <ClipboardCopy className='size-3.5' />
      </Button>
    </div>
  )
}

// Вкладка «Обновления» — только показ. Установка пакетов/образов — вручную в терминале, кнопок нет
// и не планируется без отдельного запроса с подтверждением.
export function Updates() {
  const { data, isError } = useQuery({
    queryKey: ['system-updates'],
    queryFn: async () => (await api.get<UpdatesSnapshot>('/system/updates')).data,
    // Сами данные на бэкенде кешируются часами (апт/докер проверяются фоном) — здесь просто подхватываем
    // готовый результат почаще, лишней нагрузки это не создаёт (отдаёт settings-кеш, не гоняет apt/докер)
    refetchInterval: 5 * 60_000,
  })

  if (isError) return <NoData reason='не удалось получить данные об обновлениях' />
  if (!data) return <p className='text-sm text-muted-foreground'>Загрузка…</p>

  const { apt, docker, aptHistory, dockerHistory, dockerTrackingSince } = data

  return (
    <div className='space-y-4'>
      <p className='text-xs text-muted-foreground'>Только показ — установка вручную в терминале, панель ничего не ставит сама.</p>

      {apt.rebootRequired.required && (
        <Card className='gap-2 border-warn/50 bg-warn/5'>
          <CardContent className='flex items-start gap-2 pt-4 text-sm'>
            <TriangleAlert className='mt-0.5 size-4 shrink-0 text-warn-foreground' />
            <div>
              <div className='font-medium'>Требуется перезагрузка</div>
              {apt.rebootRequired.pkgs.length > 0 && <div className='text-xs text-muted-foreground'>Причина: {apt.rebootRequired.pkgs.join(', ')}</div>}
            </div>
          </CardContent>
        </Card>
      )}

      <div className='grid gap-4 lg:grid-cols-2'>
        {/* apt: доступные обновления */}
        <Card className='gap-2'>
          <CardHeader>
            <CardTitle className='flex items-center justify-between text-sm font-medium'>
              <span>apt-пакеты</span>
              <span className='text-xs font-normal text-muted-foreground'>{apt.checkedAt ? `проверено ${formatRelative(apt.checkedAt)}` : 'проверяется…'}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            {apt.error && <NoData reason={apt.error} />}
            <div className='flex flex-wrap items-baseline gap-2'>
              <span className='text-2xl font-bold tabular-nums'>{apt.packages.length}</span>
              <span className='text-sm text-muted-foreground'>можно обновить</span>
              {apt.securityCount > 0 && <Badge variant='destructive'>{apt.securityCount} security</Badge>}
            </div>
            {apt.packages.length > 0 && (
              <div className='max-h-80 space-y-2.5 overflow-y-auto pr-1'>
                {apt.packages.map((p) => (
                  <div key={p.name} className='text-sm'>
                    <div className='flex items-center gap-2'>
                      <span className='font-medium'>{p.name}</span>
                      {p.security && (
                        <Badge variant='destructive' className='text-[10px]'>
                          security
                        </Badge>
                      )}
                    </div>
                    <div className='font-mono text-xs text-muted-foreground'>
                      {p.from} → {p.to}
                    </div>
                    {p.description && <div className='text-xs text-muted-foreground'>{p.description}</div>}
                  </div>
                ))}
              </div>
            )}
            {apt.heldBack.length > 0 && (
              <p className='text-xs text-muted-foreground'>+ {apt.heldBack.length} придержано системой (появятся поэтапно): {apt.heldBack.join(', ')}</p>
            )}
            <CopyCommand cmd='sudo apt update && sudo apt upgrade' />
          </CardContent>
        </Card>

        {/* docker: доступные обновления */}
        <Card className='gap-2'>
          <CardHeader>
            <CardTitle className='text-sm font-medium'>Docker-образы</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            {docker.map((d) => (
              <div key={d.container} className='flex items-center justify-between gap-2 text-sm'>
                <div className='min-w-0'>
                  <div className='truncate font-medium'>{d.container}</div>
                  <div className='truncate font-mono text-xs text-muted-foreground'>{d.repo}</div>
                </div>
                <div className='shrink-0 text-right'>
                  {d.error ? (
                    <StatusBadge status='unknown' label='ошибка проверки' />
                  ) : d.upToDate === null ? (
                    <StatusBadge status='unknown' label='не проверено' />
                  ) : d.upToDate ? (
                    <StatusBadge status='ok' label='актуально' />
                  ) : (
                    <StatusBadge status='warning' label='есть новее' />
                  )}
                  {d.imageCreated != null && <div className='mt-0.5 text-[10px] text-muted-foreground'>образ собран {formatRelative(d.imageCreated)}</div>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className='grid gap-4 lg:grid-cols-2'>
        {/* история apt */}
        <Card className='gap-2'>
          <CardHeader>
            <CardTitle className='text-sm font-medium'>История apt</CardTitle>
          </CardHeader>
          <CardContent className='max-h-96 space-y-3 overflow-y-auto'>
            {aptHistory.length === 0 && <NoData reason='нет записей' />}
            {aptHistory.map((e, i) => (
              <div key={i} className='text-sm'>
                <div className='flex items-center gap-2'>
                  <span className='text-xs text-muted-foreground'>{formatRelative(e.date)}</span>
                  <Badge variant='outline' className='text-[10px]'>
                    {e.manual ? 'вручную' : 'авто'}
                  </Badge>
                </div>
                <div className='mt-0.5 space-y-0.5 font-mono text-xs text-muted-foreground'>
                  {e.packages.map((p, j) => (
                    <div key={j}>
                      {p.name}: {p.from ? `${p.from} → ${p.to}` : `установлен ${p.to}`}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* история docker */}
        <Card className='gap-2'>
          <CardHeader>
            <CardTitle className='text-sm font-medium'>История Docker-образов</CardTitle>
          </CardHeader>
          <CardContent className='space-y-2.5'>
            <p className='text-xs text-muted-foreground'>
              {dockerTrackingSince
                ? `Отслеживаем с ${formatRelative(dockerTrackingSince)} — прошлых обновлений панель не видела, история только с этого момента`
                : 'Ещё не начали отслеживать'}
            </p>
            {dockerHistory.length === 0 ? (
              <NoData reason='изменений пока не замечено' />
            ) : (
              dockerHistory.map((e, i) => (
                <div key={i} className='text-sm'>
                  <div className='flex items-center gap-2'>
                    <span className='font-medium'>{e.container}</span>
                    <span className='text-xs text-muted-foreground'>{formatRelative(e.detectedAt)}</span>
                  </div>
                  <div className='font-mono text-xs text-muted-foreground'>
                    {shortDigest(e.oldDigest)} → {shortDigest(e.newDigest)}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
