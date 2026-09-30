import { useState } from 'react'
import { Value } from '@/components/value'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AxiosError } from 'axios'
import { Container as ContainerIcon, ExternalLink, Globe, HardDrive, Layers, OctagonX, Play, RotateCw, ScrollText } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Container, DockerData } from '@/lib/types'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Page } from '@/components/layout/page'
import { type Block, SortableBlocks } from '@/components/sortable-blocks'
import { NoData } from '@/components/no-data'
import { webUrl } from '@/components/service-card'
import { StatTile } from '@/components/stat-tile'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type Action = 'start' | 'stop' | 'restart'
const LABEL: Record<Action, string> = { start: 'Запустить', stop: 'Остановить', restart: 'Перезапустить' }

// Номер окружения Portainer (из адреса #!/N/…) — хранится в настройках панели
function usePortainerEndpoint() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['settings', 'portainer'],
    queryFn: async () => (await api.get<{ endpointId: number | null }>('/settings/portainer')).data.endpointId,
  })
  const save = useMutation({
    mutationFn: (endpointId: number) => api.put('/settings/portainer', { endpointId }),
    onSuccess: () => {
      toast.success('Номер окружения Portainer сохранён')
      qc.invalidateQueries({ queryKey: ['settings', 'portainer'] })
    },
    onError: () => toast.error('Не удалось сохранить'),
  })
  return { endpointId: q.data ?? null, loaded: q.isSuccess, save }
}

function PortainerSetting({ endpointId, onSave, pending }: { endpointId: number | null; onSave: (n: number) => void; pending: boolean }) {
  const [v, setV] = useState(endpointId ? String(endpointId) : '')
  return (
    <form
      className='flex flex-wrap items-center gap-2 text-sm'
      onSubmit={(e) => {
        e.preventDefault()
        const n = Number(v)
        if (Number.isInteger(n) && n > 0) onSave(n)
      }}
    >
      <span className='text-muted-foreground'>Окружение Portainer (число после «#!/» в адресе Portainer):</span>
      <Input className='h-8 w-20' inputMode='numeric' value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} placeholder='2' />
      <Button size='sm' variant='outline' type='submit' disabled={pending || !v}>
        Сохранить
      </Button>
    </form>
  )
}

export function Docker() {
  const qc = useQueryClient()
  const portainerEp = usePortainerEndpoint()
  const [pending, setPending] = useState<{ c: Container; a: Action } | null>(null)
  const { data, isError } = useQuery({
    queryKey: ['docker'],
    queryFn: async () => (await api.get<DockerData>('/docker')).data,
    refetchInterval: 15_000,
  })
  const control = useMutation({
    mutationFn: ({ c, a }: { c: Container; a: Action }) => api.post(`/docker/containers/${encodeURIComponent(c.name)}/${a}`, {}),
    onSuccess: (_d, { c, a }) => {
      toast.success(`${c.name}: ${LABEL[a].toLowerCase()} — выполнено`)
      qc.invalidateQueries({ queryKey: ['docker'] })
    },
    onError: (e, { c }) => toast.error(`${c.name}: ${(e instanceof AxiosError && e.response?.data?.message) || 'ошибка'}`),
    onSettled: () => setPending(null),
  })

  const containers = data?.containers.data ?? []
  const images = data?.images.data ?? []
  const running = containers.filter((c) => c.state === 'running').length
  const unused = images.filter((i) => !i.used)
  const portainer = containers.find((c) => c.name === 'portainer')

  const blocks: Block[] = [
    {
      id: 'engine',
      title: 'Docker',
      className: 'col-span-1',
      node: (
        <StatTile
          title='Docker'
          icon={ContainerIcon}
          value={data?.version.data ? <span className='text-info'>{data.version.data.engine}</span> : null}
          sub={data?.version.data ? `Compose ${data.version.data.compose?.split('+')[0] ?? '—'} · API ${data.version.data.api}` : undefined}
          noDataReason={data?.version.error}
        />
      ),
    },
    {
      id: 'containers-count',
      title: 'Контейнеры (счётчик)',
      className: 'col-span-1',
      node: (
        <StatTile
          title='Контейнеры'
          icon={Layers}
          value={
            data?.containers.data ? (
              <>
                <Value kind='count' value={running} /> <span className='text-base font-normal text-muted-foreground'>работает</span>
              </>
            ) : null
          }
          sub={data?.containers.data ? `остановлено: ${containers.length - running}` : undefined}
          noDataReason={data?.containers.error}
        />
      ),
    },
    {
      id: 'images',
      title: 'Образы',
      className: 'col-span-1',
      node: (
        <StatTile
          title='Образы'
          icon={HardDrive}
          value={data?.images.data ? <Value kind='count' value={images.length} suffix=' шт.' /> : null}
          sub={
            data?.images.data ? (
              <>
                занимают <Value kind='bytes' value={images.reduce((a, i) => a + i.size, 0)} />
              </>
            ) : undefined
          }
          noDataReason={data?.images.error}
        />
      ),
    },
    {
      id: 'unused',
      title: 'Неиспользуемые образы',
      className: 'col-span-1',
      node: (
        <StatTile
          title='Неиспользуемые образы'
          icon={HardDrive}
          value={data?.images.data ? <Value kind='count' value={unused.length} suffix=' шт.' /> : null}
          sub={
            unused.length ? (
              <>
                <Value kind='bytes' value={unused.reduce((a, i) => a + i.size, 0)} />: {unused.map((i) => i.tags[0] ?? i.id.slice(7, 19)).join(', ')}
              </>
            ) : (
              'всё используется'
            )
          }
        />
      ),
    },
    {
      id: 'containers',
      title: 'Контейнеры',
      className: 'col-span-2 lg:col-span-4',
      node: (
      <Card className='gap-2'>
        <CardHeader>
          <CardTitle className='text-sm font-medium'>Контейнеры</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.containers.error ? (
            <NoData reason={data.containers.error} />
          ) : (
            <div className='overflow-x-auto rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Контейнер</TableHead>
                    <TableHead className='hidden sm:table-cell'>Статус</TableHead>
                    <TableHead className='hidden md:table-cell'>Аптайм</TableHead>
                    <TableHead className='hidden lg:table-cell'>Порты</TableHead>
                    <TableHead className='hidden sm:table-cell'>CPU / RAM</TableHead>
                    <TableHead className='hidden 2xl:table-cell'>Restart</TableHead>
                    <TableHead className='hidden 2xl:table-cell'>Стек</TableHead>
                    <TableHead className='text-end'>Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {containers
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className='max-w-[10rem] sm:max-w-[16rem]'>
                          {portainer && portainerEp.endpointId ? (
                            <a
                              href={webUrl(9000, `/#!/${portainerEp.endpointId}/docker/containers/${c.id}`)}
                              target='_blank'
                              rel='noreferrer'
                              className='flex items-center gap-1 truncate font-medium hover:underline'
                              title='Открыть контейнер в Portainer'
                            >
                              {c.name} <ExternalLink className='size-3 shrink-0 text-muted-foreground' />
                            </a>
                          ) : (
                            <div className='truncate font-medium'>{c.name}</div>
                          )}
                          <div className='truncate text-xs text-muted-foreground'>{c.image}</div>
                          <StatusBadge className='mt-1 sm:hidden' status={c.state === 'running' ? 'ok' : c.state === 'restarting' ? 'warning' : 'error'} label={c.state === 'running' ? 'работает' : c.state} />
                        </TableCell>
                        <TableCell className='hidden sm:table-cell'>
                          <StatusBadge status={c.state === 'running' ? 'ok' : c.state === 'restarting' ? 'warning' : 'error'} label={c.state === 'running' ? 'работает' : c.state} />
                        </TableCell>
                        <TableCell className='hidden whitespace-nowrap md:table-cell'>
                          {c.startedAt ? <Value kind='duration' value={Math.round((Date.now() - c.startedAt) / 1000)} /> : '—'}
                        </TableCell>
                        <TableCell className='hidden lg:table-cell'>
                          {c.networkMode === 'host' && <Badge variant='outline' className='me-1'>host</Badge>}
                          {c.ports.length ? <Value kind='address' value={c.ports.map((p) => `${p.host}${p.proto === 'udp' ? '/udp' : ''}`).join(', ')} /> : '—'}
                        </TableCell>
                        <TableCell className='hidden whitespace-nowrap tabular-nums sm:table-cell'>
                          <Value kind='percent' value={c.cpuPercent} digits={1} direction='higher-worse' noDataReason='нет статистики' /> /{' '}
                          <Value kind='bytes' value={c.memUsage} noDataReason='нет статистики' />
                        </TableCell>
                        <TableCell className='hidden 2xl:table-cell'>{c.restartPolicy ?? '—'}</TableCell>
                        <TableCell className='hidden 2xl:table-cell' title={c.composeDir ?? undefined}>
                          {c.composeProject ?? '—'}
                        </TableCell>
                        <TableCell>
                          <div className='flex justify-end gap-1'>
                            {c.web && c.state === 'running' && (
                              <Button size='icon' variant='ghost' className='text-info hover:text-info' title='Открыть веб-интерфейс сервиса' aria-label='Открыть веб-интерфейс' asChild>
                                <a href={webUrl(c.web.port, c.web.path)} target='_blank' rel='noreferrer'>
                                  <Globe />
                                </a>
                              </Button>
                            )}
                            {!c.protected && (
                              <>
                                {c.state === 'running' ? (
                                  <Button size='icon' variant='destructive' title='Остановить контейнер' aria-label='Остановить' onClick={() => setPending({ c, a: 'stop' })}>
                                    <OctagonX />
                                  </Button>
                                ) : (
                                  <Button size='icon' variant='ghost' title='Запустить' onClick={() => setPending({ c, a: 'start' })}>
                                    <Play />
                                  </Button>
                                )}
                                <Button size='icon' variant='ghost' title='Перезапустить' onClick={() => setPending({ c, a: 'restart' })}>
                                  <RotateCw />
                                </Button>
                              </>
                            )}
                            <Button size='icon' variant='ghost' title='Логи' asChild>
                              <Link to='/system' search={{ tab: 'logs', source: `container:${c.name}` }}>
                                <ScrollText />
                              </Link>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className='mt-3 space-y-2 text-xs text-muted-foreground'>
            <p>
              Имя контейнера открывает его в Portainer; синий глобус <Globe className='inline size-3 text-info' /> — веб-интерфейс самого сервиса, красная кнопка <OctagonX className='inline size-3 text-danger-foreground' /> — остановка контейнера. docker-socket-proxy
              панелью не управляется: без него панель потеряет доступ к Docker.
            </p>
            {portainer && portainerEp.loaded && (
              <PortainerSetting
                key={portainerEp.endpointId ?? 'none'}
                endpointId={portainerEp.endpointId}
                pending={portainerEp.save.isPending}
                onSave={(n) => portainerEp.save.mutate(n)}
              />
            )}
          </div>
        </CardContent>
      </Card>
      ),
    },
  ]

  return (
    <Page
      title='Docker'
      description='Контейнеры, образы и compose-стеки (через docker-socket-proxy)'
      actions={
        portainer && (
          <Button asChild variant='web'>
            <a href={webUrl(9000)} target='_blank' rel='noreferrer'>
              <Globe /> Открыть Portainer
            </a>
          </Button>
        )
      }
      layoutPage='docker'
    >
      {isError && <NoData reason='бэкенд не ответил' />}
      <SortableBlocks grid blocks={blocks} className='grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4' />
      {pending && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && !control.isPending && setPending(null)}
          title={`${LABEL[pending.a]} ${pending.c.name}?`}
          desc={
            <div className='space-y-2'>
              <p>{pending.c.image}</p>
              {pending.a !== 'start' && pending.c.warning && <p className='font-medium text-danger-foreground'>⚠ {pending.c.warning}</p>}
            </div>
          }
          confirmText={LABEL[pending.a]}
          destructive={pending.a !== 'start'}
          isLoading={control.isPending}
          handleConfirm={() => control.mutate(pending)}
        />
      )}
    </Page>
  )
}
