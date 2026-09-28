import { useQuery } from '@tanstack/react-query'
import { Value } from '@/components/value'
import { Link } from '@tanstack/react-router'
import { ExternalLink, ScrollText, ShieldCheck, TriangleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDateTime, formatRelative } from '@/lib/format'
import type { Part, SitesData, UnitInfo } from '@/lib/types'
import { Page } from '@/components/layout/page'
import { NoData } from '@/components/no-data'
import { webUrl } from '@/components/service-card'
import { ServiceIcon } from '@/components/service-icon'
import { StatusBadge, unitStatus } from '@/components/status-badge'
import { UnitControls } from '@/components/unit-controls'
import { Button } from '@/components/ui/button'
import { ExchangeCard } from './exchange-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const CERT_WARN_DAYS = 30

function unit(units: Part<UnitInfo[]> | undefined, name: string) {
  return units?.data?.find((u) => u.unit === name) ?? null
}

function UnitRow({ title, icon, u, version }: { title: string; icon: string; u: UnitInfo | null; version?: string | null }) {
  return (
    <div className='flex items-center gap-3 py-1.5'>
      <ServiceIcon slug={icon} className='size-5' />
      <div className='min-w-0 flex-1'>
        <div className='text-sm font-medium'>{title}</div>
        <div className='text-xs text-muted-foreground'>
          {version ? <span className='text-info'>v{version}</span> : 'версия: нет данных'}
          {u?.since && (
            <>
              {' '}
              · работает <Value kind='duration' value={Math.round((Date.now() - u.since) / 1000)} />
            </>
          )}
        </div>
      </div>
      {u ? <StatusBadge status={unitStatus(u.active)} label={u.active === 'active' ? 'работает' : u.active} /> : <NoData />}
    </div>
  )
}

function WpChanges() {
  const posts = useQuery({
    queryKey: ['jetsetter-posts'],
    queryFn: async () => (await api.get<Part<{ id: number; title: string; type: string; status: string; modified: number }[]>>('/sites/jetsetter/posts')).data,
    staleTime: 5 * 60_000,
  })
  const files = useQuery({
    queryKey: ['jetsetter-files'],
    queryFn: async () => (await api.get<Part<{ path: string; size: number; mtime: number }[]>>('/sites/jetsetter/files')).data,
    staleTime: 10 * 60_000,
  })
  const fileList = files.data?.data ?? []
  return (
    <div className='space-y-4'>
      <Card className='gap-2'>
        <CardHeader>
          <CardTitle className='text-sm font-medium'>Последние изменённые записи WordPress</CardTitle>
        </CardHeader>
        <CardContent className='text-sm'>
          {posts.isPending ? (
            <span className='text-muted-foreground'>Загрузка (WP-CLI)…</span>
          ) : posts.data?.error ? (
            <NoData reason={posts.data.error} />
          ) : (
            <div className='grid gap-x-8 gap-y-1 lg:grid-cols-2'>
              {posts.data?.data?.map((p) => (
                <div key={p.id} className='flex justify-between gap-3 border-b border-border/50 py-1'>
                  <span className='truncate'>
                    {p.title || '(без названия)'}{' '}
                    <span className='text-xs text-muted-foreground'>
                      · {p.type === 'page' ? 'страница' : 'запись'}
                      {p.status !== 'publish' ? `, ${p.status}` : ''}
                    </span>
                  </span>
                  <span className='shrink-0 text-xs text-time tabular-nums'>{formatDateTime(p.modified)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {/* Изменённые файлы: если пусто — одна строка, без пустой карточки */}
      {files.isPending ? null : files.data?.error ? (
        <p className='text-sm text-muted-foreground'>
          Изменённые файлы сайта: <NoData reason={files.data.error} />
        </p>
      ) : fileList.length === 0 ? (
        <p className='text-sm text-muted-foreground'>Изменённые файлы сайта за 3 дня (без uploads): изменений нет.</p>
      ) : (
        <Card className='gap-2'>
          <CardHeader>
            <CardTitle className='text-sm font-medium'>Изменённые файлы сайта за 3 дня (без uploads): {fileList.length}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-1 text-sm'>
            {fileList.slice(0, 20).map((f) => (
              <div key={f.path} className='flex justify-between gap-3'>
                <Value kind='address' value={f.path} className='truncate text-xs' />
                <span className='shrink-0 text-xs text-muted-foreground tabular-nums'>
                  <Value kind='bytes' value={f.size} /> · {formatDateTime(f.mtime)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export function Sites() {
  const { data } = useQuery({
    queryKey: ['sites'],
    queryFn: async () => (await api.get<SitesData>('/sites')).data,
    refetchInterval: 15_000,
  })
  const v = data?.versions.data
  const nginx = unit(data?.units, 'nginx.service')
  const puls = unit(data?.units, 'pulsdev-api.service')
  const sync = data?.sync.data
  const cert = data?.pulsdev.cert.data
  const siteStatus = !nginx ? 'unknown' : ['nginx.service', 'php8.3-fpm.service', 'mariadb.service', 'mongod.service'].every((n) => unit(data?.units, n)?.active === 'active') ? 'ok' : 'error'

  return (
    <Page title='Сайты и API' description='Зеркало jetsetter.ua и api.pulsdev.net'>
      {/* ---------- jetsetter ---------- */}
      <Card className='gap-3'>
        <CardHeader className='flex flex-row items-start gap-3'>
          <ServiceIcon slug='wordpress' className='size-10 shrink-0' />
          <div className='min-w-0 flex-1'>
            <CardTitle className='text-base'>JetSetter — зеркало WordPress</CardTitle>
            <p className='text-xs text-muted-foreground'>WordPress {v?.wordpress ?? '—'} · /var/www/www/jetsetter.ua · порт 80</p>
          </div>
          <StatusBadge status={siteStatus} />
        </CardHeader>
        <CardContent className='space-y-4 text-sm'>
          {data?.exposure.data &&
            (data.exposure.data.restricted ? (
              <p className='flex items-center gap-2 text-ok-foreground'>
                <ShieldCheck className='size-4' /> Закрыто от интернета: доступ только {data.exposure.data.allows.join(', ')}.
              </p>
            ) : (
              <p className='flex items-center gap-2 font-medium text-danger-foreground'>
                <TriangleAlert className='size-4' /> Зеркало (копия продовой БД) доступно из интернета через порт 80 — в nginx нет allow/deny.
              </p>
            ))}
          <div className='grid gap-x-6 md:grid-cols-2'>
            <div className='divide-y'>
              <UnitRow title='nginx' icon='nginx' u={nginx} version={v?.nginx} />
              <UnitRow title='PHP-FPM' icon='php' u={unit(data?.units, 'php8.3-fpm.service')} version={v?.php} />
              <UnitRow title='MariaDB' icon='mariadb' u={unit(data?.units, 'mariadb.service')} version={v?.mariadb} />
              <UnitRow title='MongoDB' icon='mongodb' u={unit(data?.units, 'mongod.service')} version={v?.mongod} />
            </div>
            <div className='space-y-2'>
              <div className='flex flex-wrap gap-2'>
                <Button size='sm' asChild>
                  <a href={webUrl(80)} target='_blank' rel='noreferrer'>
                    <ExternalLink /> Сайт
                  </a>
                </Button>
                <Button size='sm' variant='outline' asChild>
                  <a href={webUrl(80, '/wp-admin/')} target='_blank' rel='noreferrer'>
                    <ExternalLink /> /wp-admin
                  </a>
                </Button>
              </div>
              <UnitControls
                unit='nginx.service'
                title='сайт (nginx)'
                active={nginx?.active === 'active'}
                labels={{ start: 'Запустить сайт', stop: 'Остановить сайт', restart: 'Перезапустить nginx' }}
                invalidate={['sites']}
                warning={
                  <>
                    Остановка сайта = остановка nginx. Вместе с зеркалом перестанет работать <b>pulsdev-api (api.pulsdev.net)</b> — снаружи и по HTTPS.
                    Панель продолжит работать: она не зависит от nginx.
                  </>
                }
              />
            </div>
          </div>

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-1'>
              <div className='flex items-center justify-between'>
                <span className='font-medium'>Ночной синк (05:00)</span>
                {sync ? (
                  <StatusBadge
                    status={sync.status === 'ok' ? 'ok' : sync.status === 'warnings' ? 'warning' : 'error'}
                    label={sync.status === 'ok' ? 'успешно' : sync.status === 'warnings' ? 'с предупреждениями' : 'не завершён'}
                  />
                ) : (
                  <NoData reason={data?.sync.error} />
                )}
              </div>
              {sync && (
                <>
                  <p className='text-muted-foreground'>
                    {formatDateTime(sync.started)} · длительность {sync.durationSec != null ? <Value kind='duration' value={sync.durationSec} /> : '—'} ·{' '}
                    <Value kind='ago' value={sync.started} />
                  </p>
                  {sync.errors.length > 0 && (
                    <details className='text-xs'>
                      <summary className='cursor-pointer text-warn-foreground'>Предупреждения: {sync.errors.length}</summary>
                      <pre className='mt-1 max-h-48 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap'>{sync.errors.join('\n')}</pre>
                    </details>
                  )}
                  <Button size='sm' variant='ghost' asChild>
                    <Link to='/system' search={{ tab: 'logs', source: 'file:/var/log/sync-jetsetter.log' }}>
                      <ScrollText /> Лог синка
                    </Link>
                  </Button>
                </>
              )}
            </div>
            <div className='space-y-1'>
              <div className='flex items-center justify-between'>
                <span className='font-medium'>prod-code-backup</span>
                {data?.backup.data ? (
                  <StatusBadge
                    status={data.backup.data.latestMtime && Date.now() - data.backup.data.latestMtime < 36 * 3_600_000 ? 'ok' : 'warning'}
                    label={data.backup.data.latestMtime && Date.now() - data.backup.data.latestMtime < 36 * 3_600_000 ? 'свежий' : 'устарел'}
                  />
                ) : (
                  <NoData reason={data?.backup.error} />
                )}
              </div>
              {data?.backup.data && (
                <p className='text-muted-foreground'>
                  Последний: {data.backup.data.latest} · копий {data.backup.data.count} (хранится 7 дней) · {formatRelative(data.backup.data.latestMtime)}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className='mt-4'>
        <WpChanges />
      </div>

      <div className='mt-4'>
        {/* ---------- pulsdev-api ---------- */}
        <Card className='gap-3'>
          <CardHeader className='flex flex-row items-start gap-3'>
            <ServiceIcon slug='nodejs' className='size-10 shrink-0' />
            <div className='min-w-0 flex-1'>
              <CardTitle className='text-base'>pulsdev-api (api.pulsdev.net)</CardTitle>
              <p className='text-xs text-muted-foreground'>Node.js/Express · /home/hawk/pulsdev-api · systemd pulsdev-api · 127.0.0.1:8787 ← nginx :443</p>
            </div>
            {puls ? <StatusBadge status={unitStatus(puls.active)} label={puls.active === 'active' ? 'работает' : puls.active} /> : <NoData />}
          </CardHeader>
          <CardContent className='space-y-3 text-sm'>
            <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'>
              <dt className='text-muted-foreground'>Версия</dt>
              <dd>{data?.pulsdev.version.data ? <span className='text-info'>{data.pulsdev.version.data.version}</span> : <NoData reason={data?.pulsdev.version.error} />}</dd>
              <dt className='text-muted-foreground'>Аптайм</dt>
              <dd>{puls?.since ? <Value kind='duration' value={Math.round((Date.now() - puls.since) / 1000)} /> : '—'}</dd>
              <dt className='text-muted-foreground'>/health</dt>
              <dd>
                {data?.pulsdev.health.data ? (
                  <StatusBadge status={data.pulsdev.health.data.ok ? 'ok' : 'error'} label={`«${data.pulsdev.health.data.body}» за ${data.pulsdev.health.data.ms} мс`} />
                ) : (
                  <StatusBadge status='error' label={data?.pulsdev.health.error ?? '…'} />
                )}
              </dd>
              <dt className='text-muted-foreground'>Через nginx + TLS</dt>
              <dd>
                {data?.pulsdev.healthTls.data ? (
                  <StatusBadge status={data.pulsdev.healthTls.data.status === 200 ? 'ok' : 'error'} label={`HTTP ${data.pulsdev.healthTls.data.status} за ${data.pulsdev.healthTls.data.ms} мс`} />
                ) : (
                  <NoData reason={data?.pulsdev.healthTls.error} />
                )}
              </dd>
              <dt className='text-muted-foreground'>SSL-сертификат</dt>
              <dd>
                {cert ? (
                  <StatusBadge
                    status={cert.daysLeft < 7 ? 'error' : cert.daysLeft < CERT_WARN_DAYS ? 'warning' : 'ok'}
                    label={`до ${new Date(cert.validTo).toLocaleDateString('ru-RU')} (осталось ${cert.daysLeft} дн.)`}
                  />
                ) : (
                  <NoData reason={data?.pulsdev.cert.error} />
                )}
              </dd>
            </dl>
            {cert && cert.daysLeft < CERT_WARN_DAYS && (
              <p className='flex items-start gap-2 font-medium text-warn-foreground'>
                <TriangleAlert className='mt-0.5 size-4 shrink-0' /> Сертификат истекает через {cert.daysLeft} дн. Автопродление сейчас не работает (ручной DNS-01) — см. план продления.
              </p>
            )}
            {cert && cert.daysLeft >= CERT_WARN_DAYS && (
              <p className='text-xs text-muted-foreground'>
                Продление — вручную (DNS-01): certbot.timer начнёт попытки за 30 дней до срока и без изменений зависнет.
              </p>
            )}
            <UnitControls unit='pulsdev-api.service' title='pulsdev-api' active={puls?.active === 'active'} invalidate={['sites']} warning='api.pulsdev.net перестанет отвечать; заявки с сайта pulsdev.net не будут доходить в Telegram.' />
          </CardContent>
        </Card>

      </div>

      <div className='mt-4'>
        <ExchangeCard />
      </div>
    </Page>
  )
}
