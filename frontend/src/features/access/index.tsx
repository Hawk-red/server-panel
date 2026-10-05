import { useState } from 'react'
import { AxiosError } from 'axios'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  ExternalLink,
  KeyRound,
  LogOut,
  Play,
  ShieldOff,
  OctagonX,
  TriangleAlert,
  Unlock,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { AccessData, SshKey } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { HomeLink } from '@/components/home-link'
import { useLinks } from '@/lib/links'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Page } from '@/components/layout/page'
import { NoData } from '@/components/no-data'
import { ServiceIcon } from '@/components/service-icon'
import { StatusBadge } from '@/components/status-badge'
import { UnitControls } from '@/components/unit-controls'
import { Value } from '@/components/value'

const SSH_STOP_PHRASE = 'ОТКЛЮЧИТЬ SSH'

type Pending = {
  title: string
  desc: React.JSX.Element | string
  confirm: string
  destructive?: boolean
  run: () => Promise<unknown>
}

function useAction() {
  const qc = useQueryClient()
  const [pending, setPending] = useState<Pending | null>(null)
  const m = useMutation({
    mutationFn: (p: Pending) => p.run(),
    onSuccess: (_d, p) => {
      toast.success(`${p.confirm}: выполнено`)
      qc.invalidateQueries({ queryKey: ['access'] })
    },
    onError: (e) =>
      toast.error(
        (e instanceof AxiosError && e.response?.data?.message) || 'ошибка'
      ),
    onSettled: () => setPending(null),
  })
  const dialog = pending && (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && !m.isPending && setPending(null)}
      title={pending.title}
      desc={pending.desc}
      confirmText={pending.confirm}
      destructive={pending.destructive ?? true}
      isLoading={m.isPending}
      handleConfirm={() => m.mutate(pending)}
    />
  )
  return { ask: setPending, dialog }
}

const shortFp = (fp: string) => `${fp.slice(0, 14)}…${fp.slice(-6)}`

function SshCard({
  data,
  ask,
}: {
  data?: AccessData
  ask: (p: Pending) => void
}) {
  const qc = useQueryClient()
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [phrase, setPhrase] = useState('')
  const stop = useMutation({
    mutationFn: () => api.post('/access/ssh/stop', { confirm: phrase }),
    onSuccess: () => {
      toast.success('SSH отключён')
      qc.invalidateQueries({ queryKey: ['access'] })
    },
    onError: (e) =>
      toast.error(
        (e instanceof AxiosError && e.response?.data?.message) || 'ошибка'
      ),
    onSettled: () => {
      setStep(0)
      setPhrase('')
    },
  })
  const s = data?.ssh.data
  return (
    <Card className='gap-3'>
      <CardHeader className='flex flex-row items-start gap-3'>
        <KeyRound className='size-10 shrink-0 text-muted-foreground' />
        <div className='min-w-0 flex-1'>
          <CardTitle className='text-base'>SSH (sshd)</CardTitle>
          <p className='text-xs text-muted-foreground'>
            Запуск через ssh.socket · порт открыт в ufw для всех, на роутере не
            проброшен
          </p>
        </div>
        {s ? (
          <StatusBadge
            status={s.running ? 'ok' : 'error'}
            label={s.running ? undefined : 'отключён'}
          />
        ) : (
          <NoData reason={data?.ssh.error} />
        )}
      </CardHeader>
      <CardContent className='space-y-3 text-sm'>
        {s && (
          <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'>
            <dt className='text-muted-foreground'>Порт</dt>
            <dd>{s.port}</dd>
            <dt className='text-muted-foreground'>Вход по паролю</dt>
            <dd>
              {s.passwordAuth === 'no' && s.kbdInteractive === 'no' ? (
                <StatusBadge status='ok' label='выключен' />
              ) : (
                <StatusBadge status='warning' label='включён' />
              )}
            </dd>
            <dt className='text-muted-foreground'>Вход по ключу</dt>
            <dd>{s.pubkeyAuth === 'yes' ? 'включён' : 'выключен'}</dd>
            <dt className='text-muted-foreground'>root</dt>
            <dd>
              {s.permitRootLogin === 'no'
                ? 'вход запрещён'
                : s.permitRootLogin.includes('password')
                  ? 'только по ключу'
                  : s.permitRootLogin}
            </dd>
          </dl>
        )}
        {s &&
          (s.running ? (
            <Button size='sm' variant='destructive' onClick={() => setStep(1)}>
              <OctagonX /> Отключить SSH
            </Button>
          ) : (
            <Button
              size='sm'
              onClick={() =>
                ask({
                  title: 'Включить SSH?',
                  desc: 'Запустится ssh.socket, вход по ключам снова станет доступен.',
                  confirm: 'Включить SSH',
                  destructive: false,
                  run: () => api.post('/access/ssh/start', {}),
                })
              }
            >
              <Play /> Включить SSH
            </Button>
          ))}
        {step === 1 && (
          <ConfirmDialog
            open
            onOpenChange={(o) => !o && setStep(0)}
            title='Отключить SSH целиком?'
            desc={
              <div className='space-y-2'>
                <p className='font-medium text-danger-foreground'>
                  ⚠ Все SSH-входы станут невозможны: ваш терминал, Claude Code
                  по SSH, бэкапы iPad (rsync от MacBook) и доступ с других
                  устройств.
                </p>
                <p>
                  Текущие SSH-сессии останутся, новые — нет. Вернуть SSH можно
                  будет только из этой панели (или с монитором и клавиатурой у
                  Mac Mini).
                </p>
              </div>
            }
            confirmText='Понимаю, дальше'
            destructive
            handleConfirm={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <ConfirmDialog
            open
            onOpenChange={(o) => !o && !stop.isPending && setStep(0)}
            title='Второе подтверждение'
            desc={
              <p>Введите фразу «{SSH_STOP_PHRASE}», чтобы отключить SSH.</p>
            }
            confirmText='Отключить SSH'
            destructive
            disabled={phrase !== SSH_STOP_PHRASE}
            isLoading={stop.isPending}
            handleConfirm={() => stop.mutate()}
          >
            <Input
              autoFocus
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder={SSH_STOP_PHRASE}
            />
          </ConfirmDialog>
        )}
      </CardContent>
    </Card>
  )
}

function KeysCard({
  data,
  ask,
}: {
  data?: AccessData
  ask: (p: Pending) => void
}) {
  const keys = data?.keys.data
  const toggle = (k: SshKey) =>
    ask({
      title: k.disabled
        ? `Вернуть ключ ${k.comment ?? shortFp(k.fingerprint)}?`
        : `Отключить ключ ${k.comment ?? shortFp(k.fingerprint)}?`,
      desc: k.disabled ? (
        `Строка будет раскомментирована в authorized_keys пользователя ${k.user}.`
      ) : (
        <div className='space-y-2'>
          <p>
            Ключ будет закомментирован в authorized_keys пользователя{' '}
            <b>{k.user}</b> (бэкап файла сохраняется, ключ можно вернуть).
          </p>
          {k.user === 'ipadbackup' && (
            <p className='font-medium text-danger-foreground'>
              ⚠ MacBook перестанет присылать бэкапы iPad.
            </p>
          )}
          {k.user === 'hawk' && (
            <p className='font-medium text-danger-foreground'>
              ⚠ С устройства с этим ключом нельзя будет войти по SSH как hawk.
            </p>
          )}
        </div>
      ),
      confirm: k.disabled ? 'Вернуть ключ' : 'Отключить ключ',
      destructive: !k.disabled,
      run: () =>
        api.post(`/access/keys/${k.disabled ? 'enable' : 'disable'}`, {
          user: k.user,
          fingerprint: k.fingerprint,
        }),
    })
  return (
    <Card className='gap-2'>
      <CardHeader>
        <CardTitle className='text-sm font-medium'>
          Ключи (authorized_keys всех пользователей)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!keys ? (
          <NoData reason={data?.keys.error} />
        ) : (
          <div className='overflow-x-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ключ</TableHead>
                  <TableHead>Пользователь</TableHead>
                  <TableHead className='hidden md:table-cell'>
                    Отпечаток
                  </TableHead>
                  <TableHead className='hidden sm:table-cell'>
                    Последний вход
                  </TableHead>
                  <TableHead className='text-end'>Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow
                    key={`${k.user}-${k.fingerprint}`}
                    className={cn(k.disabled && 'opacity-60')}
                  >
                    <TableCell className='max-w-[16rem]'>
                      <div className='truncate font-medium'>
                        {k.comment ?? '(без комментария)'}
                      </div>
                      <div className='flex flex-wrap gap-1 text-xs text-muted-foreground'>
                        {k.type}
                        {k.restricted && (
                          <Badge
                            variant='outline'
                            title={k.options ?? undefined}
                          >
                            ограничен
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{k.user}</TableCell>
                    <TableCell className='hidden md:table-cell'>
                      <span title={k.fingerprint}>
                        <Value
                          kind='address'
                          value={shortFp(k.fingerprint)}
                          className='text-xs'
                        />
                      </span>
                    </TableCell>
                    <TableCell className='hidden whitespace-nowrap sm:table-cell'>
                      {k.lastUsed ? (
                        <>
                          <Value kind='ago' value={k.lastUsed.ts} />
                          <Value
                            kind='address'
                            value={k.lastUsed.ip}
                            className='block text-xs'
                          />
                        </>
                      ) : (
                        <span className='text-muted-foreground'>
                          не за 90 дней
                        </span>
                      )}
                    </TableCell>
                    <TableCell className='text-end'>
                      <Button
                        size='sm'
                        variant={k.disabled ? 'outline' : 'ghost'}
                        onClick={() => toggle(k)}
                      >
                        {k.disabled ? (
                          <>
                            <Unlock /> вернуть
                          </>
                        ) : (
                          <>
                            <Ban /> отключить
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className='mt-2 text-xs text-muted-foreground'>
          Последний активный ключ hawk отключить нельзя — защита от потери
          доступа.
        </p>
      </CardContent>
    </Card>
  )
}

function SessionsCard({
  data,
  ask,
}: {
  data?: AccessData
  ask: (p: Pending) => void
}) {
  const [filter, setFilter] = useState<'all' | 'ok' | 'fail'>('all')
  const history = (data?.history.data ?? []).filter(
    (h) => filter === 'all' || (filter === 'ok' ? h.ok : !h.ok)
  )
  return (
    <>
      <Card className='gap-2'>
        <CardHeader>
          <CardTitle className='text-sm font-medium'>Активные сессии</CardTitle>
        </CardHeader>
        <CardContent className='space-y-2 text-sm'>
          {!data?.sessions.data ? (
            <NoData reason={data?.sessions.error} />
          ) : (
            data.sessions.data.map((s) => (
              <div
                key={s.id}
                className='flex items-center justify-between gap-2'
              >
                <div className='min-w-0'>
                  <div className='font-medium'>
                    {s.user}{' '}
                    <span className='font-normal text-muted-foreground'>
                      · {s.service ?? s.type}
                    </span>
                  </div>
                  <div className='text-xs text-muted-foreground'>
                    {s.from ? (
                      <>
                        с <Value kind='address' value={s.from} />
                      </>
                    ) : (
                      'локально'
                    )}
                    {s.tty ? ` · ${s.tty}` : ''} · с {formatDateTime(s.since)}
                  </div>
                </div>
                {s.killable && (
                  <Button
                    size='sm'
                    variant='ghost'
                    onClick={() =>
                      ask({
                        title: `Завершить сессию ${s.user} (${s.from ?? 'локально'})?`,
                        desc: (
                          <div className='space-y-2'>
                            <p>
                              Все процессы этой сессии будут остановлены,
                              несохранённая работа в терминале пропадёт.
                            </p>
                            <p className='text-warn-foreground'>
                              Если это ваш собственный терминал (или Claude
                              Code) — он будет закрыт.
                            </p>
                          </div>
                        ),
                        confirm: 'Завершить сессию',
                        run: () =>
                          api.post(`/access/sessions/${s.id}/kill`, {}),
                      })
                    }
                  >
                    <LogOut /> завершить
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
      <Card className='gap-2'>
        <CardHeader className='flex flex-row items-center justify-between'>
          <CardTitle className='text-sm font-medium'>
            История входов по SSH (7 дней)
          </CardTitle>
          <Select
            value={filter}
            onValueChange={(v) => setFilter(v as typeof filter)}
          >
            <SelectTrigger className='h-8 w-36'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>все</SelectItem>
              <SelectItem value='ok'>успешные</SelectItem>
              <SelectItem value='fail'>неудачные</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className='max-h-80 space-y-1 overflow-auto text-sm'>
          {!data?.history.data ? (
            <NoData reason={data?.history.error} />
          ) : history.length === 0 ? (
            <span className='text-muted-foreground'>пусто</span>
          ) : (
            history.slice(0, 100).map((h, i) => (
              <div key={i} className='flex items-center justify-between gap-2'>
                <StatusBadge
                  status={h.ok ? 'ok' : 'error'}
                  label={`${h.user}${h.ok ? '' : ` (${h.method})`}`}
                />
                <span className='text-xs text-muted-foreground tabular-nums'>
                  <Value kind='address' value={h.ip} /> · {formatDateTime(h.ts)}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </>
  )
}

function BlockingCard({
  data,
  ask,
}: {
  data?: AccessData
  ask: (p: Pending) => void
}) {
  const [ip, setIp] = useState('')
  const [jail, setJail] = useState('sshd')
  const [target, setTarget] = useState<'ufw' | 'f2b'>('ufw')
  const f2b = data?.f2b.data
  const vpnIgnored = f2b?.ignoreip.some((x) => x.startsWith('10.10.10.'))
  return (
    <>
      <Card className='gap-2'>
        <CardHeader>
          <CardTitle className='text-sm font-medium'>fail2ban</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3 text-sm'>
          {!f2b ? (
            <NoData reason={data?.f2b.error} />
          ) : (
            <>
              {f2b.jails.map((j) => (
                <div key={j.name} className='space-y-1'>
                  <div className='flex justify-between'>
                    <span className='font-medium'>{j.name}</span>
                    <span className='text-xs text-muted-foreground'>
                      попыток сейчас {j.currentlyFailed} (всего {j.totalFailed})
                      · забанено {j.currentlyBanned} (всего {j.totalBanned})
                    </span>
                  </div>
                  {j.banned.map((b) => (
                    <div
                      key={b}
                      className='flex items-center justify-between rounded bg-muted/50 px-2 py-1'
                    >
                      <Value kind='address' value={b} className='text-xs' />
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={() =>
                          ask({
                            title: `Разбанить ${b} в ${j.name}?`,
                            desc: 'IP снова сможет подключаться.',
                            confirm: 'Разбанить',
                            destructive: false,
                            run: () =>
                              api.post('/access/f2b/unban', {
                                jail: j.name,
                                ip: b,
                              }),
                          })
                        }
                      >
                        <Unlock /> разбанить
                      </Button>
                    </div>
                  ))}
                </div>
              ))}
              <p className='text-xs text-muted-foreground'>
                Не банятся: {f2b.ignoreip.join(', ') || '—'}
              </p>
              {!vpnIgnored && (
                <p className='flex items-start gap-1 text-xs text-warn-foreground'>
                  <TriangleAlert className='mt-0.5 size-3 shrink-0' /> VPN-сеть
                  10.10.10.0/24 не в ignoreip — клиента WireGuard можно случайно
                  забанить.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
      <Card className='gap-2'>
        <CardHeader>
          <CardTitle className='text-sm font-medium'>
            Блокировки IP в ufw
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-3 text-sm'>
          {!data?.ufw.data ? (
            <NoData reason={data?.ufw.error} />
          ) : data.ufw.data.length === 0 ? (
            <span className='text-muted-foreground'>
              Заблокированных адресов нет.
            </span>
          ) : (
            data.ufw.data.map((r) => (
              <div
                key={r.num}
                className='flex items-center justify-between rounded bg-muted/50 px-2 py-1'
              >
                <span>
                  <Value kind='address' value={r.from} className='text-xs' />{' '}
                  <span className='text-xs text-muted-foreground'>
                    → {r.to}
                    {r.panel ? ' · из панели' : ''}
                  </span>
                </span>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={() =>
                    ask({
                      title: `Разблокировать ${r.from}?`,
                      desc: 'Правило deny будет удалено из ufw.',
                      confirm: 'Разблокировать',
                      destructive: false,
                      run: () => api.post('/access/ufw/undeny', { ip: r.from }),
                    })
                  }
                >
                  <Unlock /> снять
                </Button>
              </div>
            ))
          )}
          <div className='space-y-2 border-t pt-3'>
            <div className='font-medium'>Заблокировать IP</div>
            <div className='flex flex-wrap gap-2'>
              <Input
                className='w-44'
                placeholder='1.2.3.4 или 1.2.3.0/24'
                value={ip}
                onChange={(e) => setIp(e.target.value.trim())}
              />
              <Select
                value={target}
                onValueChange={(v) => setTarget(v as typeof target)}
              >
                <SelectTrigger className='w-40'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='ufw'>ufw (всё)</SelectItem>
                  <SelectItem value='f2b'>fail2ban (jail)</SelectItem>
                </SelectContent>
              </Select>
              {target === 'f2b' && (
                <Select value={jail} onValueChange={setJail}>
                  <SelectTrigger className='w-28'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(f2b?.jails ?? [{ name: 'sshd' }]).map((j) => (
                      <SelectItem key={j.name} value={j.name}>
                        {j.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button
                size='sm'
                variant='destructive'
                disabled={!ip}
                onClick={() =>
                  ask({
                    title: `Заблокировать ${ip}?`,
                    desc:
                      target === 'ufw'
                        ? 'Правило deny from IP встанет первым в ufw: любые подключения с этого адреса будут отброшены.'
                        : `IP будет забанен в jail ${jail} на время bantime.`,
                    confirm: 'Заблокировать',
                    run: () =>
                      target === 'ufw'
                        ? api.post('/access/ufw/deny', { ip })
                        : api.post('/access/f2b/ban', { jail, ip }),
                  })
                }
              >
                <ShieldOff /> Заблокировать
              </Button>
            </div>
            <p className='text-xs text-muted-foreground'>
              Свои сети (192.168.31.0/24, 10.10.10.0/24, localhost)
              заблокировать нельзя.
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  )
}

function RemoteCard({ data, part }: { data?: AccessData; part: 'rdp' | 'wg' }) {
  const r = data?.remote.data
  // Адрес сервера в LAN приходит с сервера (не из адреса страницы); снаружи его нет — ссылки неактивны
  const links = useLinks()
  const host = links.lanHost
  const wg = data?.wg.data
  return (
    <>
      {part === 'rdp' && (
        <Card className='gap-2'>
          <CardHeader>
            <CardTitle className='text-sm font-medium'>
              Удалённый рабочий стол
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-4 text-sm'>
            {!r ? (
              <NoData reason={data?.remote.error} />
            ) : (
              <>
                <div className='space-y-2'>
                  <div className='flex items-center justify-between'>
                    <span className='font-medium'>RDP (xrdp, :3389)</span>
                    <StatusBadge
                      status={
                        r.rdp.service === 'active' && r.rdp.listening
                          ? 'ok'
                          : 'error'
                      }
                    />
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    <Button size='sm' asChild>
                      <HomeLink newTab={false} href={host ? `rdp://full%20address=s:${host}:3389` : undefined}>
                        <ExternalLink /> rdp://{host ?? 'сервер'}
                      </HomeLink>
                    </Button>
                    <UnitControls
                      unit='xrdp.service'
                      title='xrdp'
                      active={r.rdp.service === 'active'}
                      invalidate={['access']}
                      warning='Активные RDP-сессии будут разорваны.'
                    />
                  </div>
                </div>
                <div className='space-y-1'>
                  <div className='flex items-center justify-between'>
                    <span className='font-medium'>VNC (:5900)</span>
                    <StatusBadge
                      status={r.vnc.listening ? 'ok' : 'unknown'}
                      label={r.vnc.listening ? undefined : 'не настроен'}
                    />
                  </div>
                  {r.vnc.listening ? (
                    <Button size='sm' asChild>
                      <HomeLink newTab={false} href={host ? `vnc://${host}:5900` : undefined}>
                        <ExternalLink /> vnc://{host ?? 'сервер'}
                      </HomeLink>
                    </Button>
                  ) : (
                    <p className='text-xs text-muted-foreground'>
                      VNC-сервер на Mac Mini не установлен (порт 5900 никто не
                      слушает), включать нечего. Правило ufw для 5900 — лишнее.
                    </p>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
      {part === 'wg' && (
        <Card className='gap-2'>
          <CardHeader className='flex flex-row items-start gap-3'>
            <ServiceIcon slug='wireguard' className='size-8 shrink-0' />
            <div className='flex-1'>
              <CardTitle className='text-sm font-medium'>
                WireGuard (wg0)
              </CardTitle>
              <p className='text-xs text-muted-foreground'>
                10.10.10.1/24 · UDP {wg?.iface?.port ?? 51820}
              </p>
            </div>
            {wg ? (
              <StatusBadge status={wg.status === 'active' ? 'ok' : 'error'} />
            ) : (
              <NoData reason={data?.wg.error} />
            )}
          </CardHeader>
          <CardContent className='space-y-2 text-sm'>
            {wg?.peers.map((p) => {
              const online =
                p.handshake != null && Date.now() - p.handshake < 3 * 60_000
              return (
                <div key={p.publicKey} className='rounded border p-2'>
                  <div className='flex items-center justify-between'>
                    <span className='font-medium'>
                      {p.name ?? 'клиент без имени'}{' '}
                      <Value
                        kind='address'
                        value={p.allowedIps}
                        className='font-normal'
                      />
                    </span>
                    <StatusBadge
                      status={online ? 'ok' : 'unknown'}
                      label={online ? 'на связи' : 'не на связи'}
                    />
                  </div>
                  <div className='text-xs text-muted-foreground'>
                    handshake:{' '}
                    {p.handshake ? (
                      <Value kind='ago' value={p.handshake} />
                    ) : (
                      'никогда'
                    )}{' '}
                    · <Value kind='bytes' value={p.rx} flow='rx' prefix='↓ ' />{' '}
                    <Value kind='bytes' value={p.tx} flow='tx' prefix='↑ ' />
                    {p.endpoint && (
                      <>
                        {' '}
                        · <Value kind='address' value={p.endpoint} />
                      </>
                    )}
                  </div>
                </div>
              )
            })}
            {wg && wg.peers.length === 0 && (
              <span className='text-muted-foreground'>Клиентов нет.</span>
            )}
            <p className='text-xs text-muted-foreground'>
              Имя клиента берётся из комментария «# Имя» перед [Peer] в
              /etc/wireguard/wg0.conf.
            </p>
          </CardContent>
        </Card>
      )}
    </>
  )
}

export function Access() {
  const { data } = useQuery({
    queryKey: ['access'],
    queryFn: async () => (await api.get<AccessData>('/access')).data,
    refetchInterval: 15_000,
  })
  const { ask, dialog } = useAction()
  return (
    <Page
      title='SSH и доступ'
      description='Ключи, сессии, fail2ban, блокировки, удалённый рабочий стол и VPN'
    >
      {/* Порядок по важности: сессии и входы → fail2ban и блокировки → ключи → WireGuard → SSH-служба → RDP.
          Карточки в колонках (masonry) — без пустых дыр. */}
      <div className='space-y-4'>
        <div className='columns-1 gap-4 lg:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid'>
          <SessionsCard data={data} ask={ask} />
          <BlockingCard data={data} ask={ask} />
        </div>
        <KeysCard data={data} ask={ask} />
        <div className='columns-1 gap-4 lg:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid'>
          <RemoteCard data={data} part='wg' />
          <SshCard data={data} ask={ask} />
          <RemoteCard data={data} part='rdp' />
        </div>
      </div>
      {dialog}
    </Page>
  )
}
