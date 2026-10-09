// Блок «Docker-образы» раздела «Обновления»: версии «было → станет», статусы, замки.
import { Download, Loader2, Lock, RefreshCw } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatRelative } from '@/lib/format'
import type { DockerImageStatus, UpdatesSnapshot } from '@/lib/types'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const shortDigest = (d: string | null) => (d ? d.replace(/^sha256:/, '').slice(0, 8) : '—')
const ver = (v: string) => (/^\d/.test(v) ? `v${v}` : v)

// 17.09 (год добавляем, только если не текущий)
function shortDate(ts: number | null): string {
  if (ts == null) return '—'
  const d = new Date(ts)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return d.getFullYear() === new Date().getFullYear() ? `${dd}.${mm}` : `${dd}.${mm}.${d.getFullYear()}`
}

// «v12.1 → v12.2»; нет метки версии — «сборка 17.09 → 08.10 · 4d616db1 → 03f94a40»
export function imageDelta(d: DockerImageStatus): string {
  const newer = d.upToDate === false
  if (d.localVersion && (!newer || d.remoteVersion)) return newer ? `${ver(d.localVersion)} → ${ver(d.remoteVersion!)}` : ver(d.localVersion)
  if (newer) return `сборка ${shortDate(d.imageCreated)} → ${shortDate(d.remoteCreated)} · ${shortDigest(d.localDigest)} → ${shortDigest(d.remoteDigest)}`
  return `сборка ${shortDate(d.imageCreated)} · ${shortDigest(d.localDigest)}`
}

export function StatusOf({ d }: { d: DockerImageStatus }) {
  if (d.error) return <StatusBadge status='unknown' label='Ошибка проверки' />
  if (d.upToDate === null) return <StatusBadge status='unknown' label='Не проверено' />
  if (d.upToDate) return <StatusBadge status='ok' label='Актуален' />
  return <StatusBadge status='warning' label='Есть новее' />
}

export function DockerImages({ docker, extra }: { docker: DockerImageStatus[]; extra?: (d: DockerImageStatus) => React.ReactNode }) {
  const qc = useQueryClient()
  const newer = docker.filter((d) => d.upToDate === false).length
  const check = useMutation({
    mutationFn: async () => (await api.post<UpdatesSnapshot>('/system/updates/docker/check')).data,
    onSuccess: (data) => {
      qc.setQueryData(['system-updates'], data)
      toast.success('Образы проверены')
    },
    onError: (e) => toast.error((e instanceof AxiosError && e.response?.data?.message) || 'не удалось проверить образы'),
  })

  return (
    <Card className='gap-3'>
      <CardHeader className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
        <CardTitle className='flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium'>
          <span className='flex items-center gap-2'>
            <Download className='size-4 text-info' /> Docker-образы
          </span>
          <span className={newer ? 'text-warn-foreground' : 'text-muted-foreground'}>
            Есть новее: {newer} из {docker.length}
          </span>
        </CardTitle>
        <Button size='sm' variant='outline' className='self-start sm:self-auto' onClick={() => check.mutate()} disabled={check.isPending}>
          {check.isPending ? <Loader2 className='size-4 animate-spin' /> : <RefreshCw className='size-4' />}
          Проверить сейчас
        </Button>
      </CardHeader>
      <CardContent className='grid gap-2'>
        {docker.map((d) => (
          <div key={d.container} className='flex flex-col gap-2 rounded-lg border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3'>
            <div className='min-w-0 space-y-0.5'>
              <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
                <span className='font-medium'>{d.container}</span>
                {!d.managed && (
                  <Badge variant='outline' className='text-[10px] font-normal text-muted-foreground' title={d.recreateBlock ?? undefined}>
                    Нельзя пересоздать{d.composeProject ? '' : ' (нет compose)'}
                  </Badge>
                )}
              </div>
              <div className='truncate font-mono text-[11px] text-muted-foreground'>
                {d.repo}
              </div>
              <div className='font-mono text-xs break-words'>{imageDelta(d)}</div>
              {d.error && <div className='text-[11px] break-words text-danger-foreground'>{d.error}</div>}
              {d.checkedAt != null && <div className='text-[11px] text-muted-foreground'>проверено {formatRelative(d.checkedAt)}</div>}
              {d.lock && (
                <div className='flex items-center gap-1 text-[11px] text-warn-foreground'>
                  <Lock className='size-3 shrink-0' /> Замок: {d.lock}
                </div>
              )}
              {d.note && <div className='text-[11px] text-muted-foreground'>{d.note}</div>}
            </div>
            <div className='flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end'>
              <StatusOf d={d} />
              {extra?.(d)}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
