import { useQuery } from '@tanstack/react-query'
import { ExternalLink, House, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import { HA_SHORTCUTS, haStatusView, type HaPageStatus } from '@/lib/homeassistant'
import { Page } from '@/components/layout/page'
import { HomeLink } from '@/components/home-link'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

const ago = (at: number | null) => {
  if (!at) return 'ещё не читалось'
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  return s < 60 ? `${s} с назад` : `${Math.round(s / 60)} мин назад`
}

/** Страница «Home Assistant»: состояние связи панели с HA и быстрый переход в сам HA. Управления здесь нет — оно на «Умном доме» */
export function HomeAssistantPage() {
  const q = useQuery({
    queryKey: ['homeassistant-status'],
    queryFn: async () => (await api.get<HaPageStatus>('/homeassistant/status')).data,
    refetchInterval: (r) => (r.state.data?.status === 'pending' ? 2000 : 15_000),
  })
  const s = q.data
  const view = haStatusView(s, q.isError)

  return (
    <Page title='Home Assistant' description='Связь панели с Home Assistant и переход в него'>
      <div className='space-y-4'>
        <Card>
          <CardContent className='space-y-4'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
              <div className='min-w-0 space-y-1'>
                <div className='flex items-center gap-2'>
                  <House className='size-5 shrink-0 text-brand' aria-hidden />
                  <h2 className='text-sm font-medium'>{s?.locationName ?? 'Home Assistant'}</h2>
                  <StatusBadge status={view.status} label={view.label} />
                </div>
                <p className='text-xs text-muted-foreground'>
                  {s?.version ? `Версия ${s.version}` : 'Версия неизвестна'} · синхронизация {ago(s?.syncedAt ?? null)}
                  {s?.live ? ' · события приходят' : ''}
                </p>
                {view.hint && <p className='text-xs text-danger-foreground'>{view.hint}</p>}
              </div>
              <Button size='sm' variant='outline' onClick={() => void q.refetch()} disabled={q.isFetching}>
                <RefreshCw className={q.isFetching ? 'animate-spin' : undefined} /> Обновить
              </Button>
            </div>

            <dl className='grid grid-cols-3 gap-3 text-center'>
              {[
                { k: 'Устройства', v: s ? String(s.devices) : '—' },
                { k: 'В сети', v: s ? String(s.devicesOnline) : '—' },
                { k: 'Сцены', v: s ? String(s.scenes) : '—' },
              ].map((x) => (
                <div key={x.k} className='rounded-lg border px-2 py-3'>
                  <dt className='text-xs text-muted-foreground'>{x.k}</dt>
                  <dd className='text-xl font-semibold tabular-nums'>{x.v}</dd>
                </div>
              ))}
            </dl>

            <Button asChild size='lg' className='h-14 w-full text-base'>
              <HomeLink service='homeassistant' path='/' rel='noopener noreferrer'>
                <ExternalLink /> Открыть Home Assistant
              </HomeLink>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className='space-y-3'>
            <h2 className='text-sm font-medium'>Быстрые переходы</h2>
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3'>
              {HA_SHORTCUTS.map((l) => (
                <HomeLink
                  key={l.id}
                  service='homeassistant'
                  path={l.path}
                  rel='noopener noreferrer'
                  className='flex min-h-16 items-center gap-2 rounded-lg border px-3 py-2 hover:bg-muted'
                >
                  <div className='min-w-0 flex-1'>
                    <div className='truncate text-sm font-medium'>{l.title}</div>
                    <div className='truncate text-[11px] text-muted-foreground'>{l.subtitle}</div>
                  </div>
                  <ExternalLink className='size-3.5 shrink-0 text-muted-foreground' aria-hidden />
                </HomeLink>
              ))}
            </div>
            <p className='text-xs text-muted-foreground'>Переключатели, сцены и устройства остались на странице «Умный дом» — здесь только переходы в сам Home Assistant.</p>
          </CardContent>
        </Card>
      </div>
    </Page>
  )
}
