import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { Copy, Globe, KeyRound, ShieldCheck, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { copyText } from '@/lib/clipboard'
import { formatDateTime } from '@/lib/format'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Page } from '@/components/layout/page'
import { NoData } from '@/components/no-data'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

type Session = { id: string; source: 'internal' | 'external'; ip: string; userAgent: string | null; createdAt: number; lastSeen: number; expiresAt: number; secondFactor: boolean; current: boolean }
type SecurityState = {
  totp: { enabled: boolean; enabledAt: number | null; recoveryLeft: number }
  external: { enabled: boolean }
  sessions: Session[]
}
type Setup = { secret: string; otpauth: string; qr: string }

const errMsg = (e: unknown) => (e instanceof AxiosError && e.response?.data?.message) || 'не удалось выполнить'

// Короткая подпись устройства по user-agent
function device(ua: string | null) {
  if (!ua) return 'неизвестно'
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /curl/.test(ua) ? 'curl' : ''
  return [br, os].filter(Boolean).join(' · ') || ua.slice(0, 40)
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className='space-y-3 rounded-md border border-warn/40 bg-warn/5 p-3'>
      <p className='text-sm font-medium'>Коды восстановления — сохраните сейчас</p>
      <p className='text-xs text-muted-foreground'>Каждый код работает один раз, если потеряете телефон. Больше они нигде не показываются: в панели хранятся только их отпечатки.</p>
      <ul className='grid grid-cols-2 gap-1 font-mono text-sm'>
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className='flex flex-wrap gap-2'>
        <Button size='sm' variant='outline' onClick={() => copyText(codes.join('\n')).then(() => toast.success('Скопировано'))}>
          <Copy /> Скопировать
        </Button>
        <Button size='sm' onClick={onDone}>
          Я сохранил(а) коды
        </Button>
      </div>
    </div>
  )
}

// Подтверждение паролем и кодом (отключение 2FA, пересоздание кодов восстановления)
function PasswordCodeDialog({ title, desc, confirmText, destructive, onClose, onSubmit }: { title: string; desc: string; confirmText: string; destructive?: boolean; onClose: () => void; onSubmit: (password: string, code: string) => Promise<void> }) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>
        <form
          className='space-y-3'
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError(null)
            try {
              await onSubmit(password, code.trim())
            } catch (err) {
              setError(errMsg(err))
              setCode('')
            } finally {
              setBusy(false)
            }
          }}
        >
          <div className='space-y-1.5'>
            <Label htmlFor='sec-pw'>Пароль панели</Label>
            <Input id='sec-pw' type='password' autoComplete='current-password' value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='sec-code'>Код из приложения или код восстановления</Label>
            <Input id='sec-code' autoComplete='one-time-code' value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          {error && <p className='text-sm text-danger-foreground'>{error}</p>}
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose} disabled={busy}>
              Отмена
            </Button>
            <Button type='submit' variant={destructive ? 'destructive' : 'default'} disabled={busy || !password || !code}>
              {confirmText}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TotpCard({ s, onChanged }: { s: SecurityState; onChanged: () => void }) {
  const [setup, setSetup] = useState<Setup | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [dialog, setDialog] = useState<'disable' | 'recovery' | null>(null)

  const start = useMutation({
    mutationFn: async () => (await api.post<Setup>('/security/totp/setup', {})).data,
    onSuccess: setSetup,
    onError: (e) => toast.error(errMsg(e)),
  })
  const enable = useMutation({
    mutationFn: async () => (await api.post<{ recoveryCodes: string[] }>('/security/totp/enable', { code: code.trim() })).data,
    onSuccess: (r) => {
      setSetup(null)
      setCode('')
      setCodes(r.recoveryCodes)
      onChanged()
      toast.success('Двухфакторный вход включён')
    },
    onError: (e) => toast.error(errMsg(e)),
  })

  return (
    <Card className='gap-3'>
      <CardHeader className='flex flex-row items-center justify-between gap-2'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Smartphone className='size-4 text-brand' aria-hidden /> Двухфакторный вход (TOTP)
        </CardTitle>
        <StatusBadge status={s.totp.enabled ? 'ok' : 'warning'} label={s.totp.enabled ? 'включён' : 'выключен'} />
      </CardHeader>
      <CardContent className='space-y-3 text-sm'>
        <p className='text-muted-foreground'>
          Код из приложения-аутентификатора (Google Authenticator, Aegis, 1Password и др.) нужен при входе из интернета. Из домашней сети и по WireGuard вход, как раньше, только по паролю.
        </p>
        {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}
        {!s.totp.enabled && !setup && (
          <Button onClick={() => start.mutate()} disabled={start.isPending}>
            <ShieldCheck /> Включить
          </Button>
        )}
        {setup && (
          <div className='space-y-3'>
            <ol className='list-decimal space-y-1 ps-5 text-muted-foreground'>
              <li>Отсканируйте QR-код приложением-аутентификатором (QR создан на сервере, наружу ничего не уходит) или введите секрет вручную.</li>
              <li>Введите 6-значный код из приложения, чтобы подтвердить.</li>
            </ol>
            <div className='flex flex-wrap items-start gap-4'>
              <img src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qr)}`} alt='QR-код для аутентификатора' className='size-44 rounded-md border bg-white p-1' />
              <div className='min-w-0 space-y-1'>
                <div className='text-xs text-muted-foreground'>Секрет (текстом)</div>
                <code className='block rounded bg-muted px-2 py-1 font-mono text-sm break-all'>{setup.secret}</code>
              </div>
            </div>
            <form
              className='flex flex-wrap gap-2'
              onSubmit={(e) => {
                e.preventDefault()
                enable.mutate()
              }}
            >
              <Input className='w-40' inputMode='numeric' autoComplete='one-time-code' placeholder='6 цифр' maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} aria-label='Код из приложения' />
              <Button type='submit' disabled={enable.isPending || code.trim().length !== 6}>
                Подтвердить
              </Button>
              <Button type='button' variant='ghost' onClick={() => setSetup(null)}>
                Отмена
              </Button>
            </form>
          </div>
        )}
        {s.totp.enabled && (
          <>
            <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1'>
              <dt className='text-muted-foreground'>Включён</dt>
              <dd>{s.totp.enabledAt ? formatDateTime(s.totp.enabledAt) : '—'}</dd>
              <dt className='text-muted-foreground'>Кодов восстановления осталось</dt>
              <dd>{s.totp.recoveryLeft}</dd>
            </dl>
            <div className='flex flex-wrap gap-2'>
              <Button variant='outline' onClick={() => setDialog('recovery')}>
                <KeyRound /> Пересоздать коды восстановления
              </Button>
              <Button variant='outline' onClick={() => setDialog('disable')}>
                Отключить
              </Button>
            </div>
            <p className='text-xs text-muted-foreground'>Отключение и пересоздание кодов — только по паролю и коду. После них все остальные сессии завершаются.</p>
          </>
        )}
      </CardContent>
      {dialog === 'disable' && (
        <PasswordCodeDialog
          title='Отключить двухфакторный вход?'
          desc='Доступ из интернета будет выключен, остальные сессии завершатся.'
          confirmText='Отключить'
          destructive
          onClose={() => setDialog(null)}
          onSubmit={async (password, code) => {
            await api.post('/security/totp/disable', { password, code })
            setDialog(null)
            onChanged()
            toast.success('Двухфакторный вход отключён')
          }}
        />
      )}
      {dialog === 'recovery' && (
        <PasswordCodeDialog
          title='Пересоздать коды восстановления?'
          desc='Старые коды перестанут работать. Остальные сессии завершатся.'
          confirmText='Пересоздать'
          onClose={() => setDialog(null)}
          onSubmit={async (password, code) => {
            const r = await api.post<{ recoveryCodes: string[] }>('/security/totp/recovery', { password, code })
            setDialog(null)
            setCodes(r.data.recoveryCodes)
            onChanged()
          }}
        />
      )}
    </Card>
  )
}

function ExternalCard({ s, onChanged }: { s: SecurityState; onChanged: () => void }) {
  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => api.post('/security/external', { enabled }),
    onSuccess: (_r, enabled) => {
      toast.success(enabled ? 'Доступ из интернета разрешён' : 'Доступ из интернета выключен')
      onChanged()
    },
    onError: (e) => toast.error(errMsg(e)),
  })
  return (
    <Card className='gap-3'>
      <CardHeader className='flex flex-row items-center justify-between gap-2'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Globe className='size-4 text-info' aria-hidden /> Доступ из интернета
        </CardTitle>
        <StatusBadge status={s.external.enabled ? 'warning' : 'ok'} label={s.external.enabled ? 'разрешён' : 'выключен'} />
      </CardHeader>
      <CardContent className='space-y-3 text-sm'>
        <p className='text-muted-foreground'>
          Выключатель в самой панели: пока он выключен, внешние запросы получают 403, даже если nginx открыт. Включить можно только при включённом двухфакторном входе. Снаружи недоступны опасные действия (перезагрузка, откат, SSH, обновления, Docker и т. п.), сессия живёт 12 часов.
        </p>
        <div className='flex items-center gap-3'>
          <Switch id='ext-switch' checked={s.external.enabled} disabled={toggle.isPending || (!s.external.enabled && !s.totp.enabled)} onCheckedChange={(v) => toggle.mutate(v)} />
          <Label htmlFor='ext-switch'>{s.external.enabled ? 'Разрешён вход снаружи (пароль и код)' : s.totp.enabled ? 'Выключен' : 'Сначала включите двухфакторный вход'}</Label>
        </div>
      </CardContent>
    </Card>
  )
}

function SessionsCard({ s, onChanged }: { s: SecurityState; onChanged: () => void }) {
  const [confirm, setConfirm] = useState<'others' | 'all' | null>(null)
  const endAll = useMutation({
    mutationFn: async (includeCurrent: boolean) => (await api.post<{ ended: number }>('/security/sessions/end-all', { includeCurrent })).data,
    onSuccess: (r, includeCurrent) => {
      setConfirm(null)
      if (includeCurrent) window.location.assign('/sign-in')
      else {
        toast.success(`Завершено сессий: ${r.ended}`)
        onChanged()
      }
    },
    onError: (e) => toast.error(errMsg(e)),
  })
  const end = useMutation({
    mutationFn: async (id: string) => api.post(`/security/sessions/${id}/end`, {}),
    onSuccess: onChanged,
    onError: (e) => toast.error(errMsg(e)),
  })
  return (
    <Card className='gap-3'>
      <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-2'>
        <CardTitle className='text-base'>Активные сессии ({s.sessions.length})</CardTitle>
        <div className='flex flex-wrap gap-2'>
          <Button size='sm' variant='outline' onClick={() => setConfirm('others')} disabled={s.sessions.length < 2}>
            Выйти на остальных
          </Button>
          <Button size='sm' variant='outline' onClick={() => setConfirm('all')}>
            Выйти везде
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {s.sessions.length === 0 ? (
          <NoData />
        ) : (
          <ul className='divide-y'>
            {s.sessions.map((x) => (
              <li key={x.id} className='flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5 text-sm'>
                <div className='min-w-0'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='font-medium'>{device(x.userAgent)}</span>
                    <StatusBadge status={x.source === 'external' ? 'warning' : 'ok'} label={x.source === 'external' ? 'снаружи' : 'из дома / VPN'} className='text-xs' />
                    {x.current && <span className='text-xs text-info'>это вы</span>}
                  </div>
                  <div className='text-xs text-muted-foreground'>
                    <span className='font-mono'>{x.ip}</span> · вход {formatDateTime(x.createdAt)} · активность {formatDateTime(x.lastSeen)} · истекает {formatDateTime(x.expiresAt)}
                  </div>
                </div>
                {!x.current && (
                  <Button size='sm' variant='ghost' onClick={() => end.mutate(x.id)} disabled={end.isPending}>
                    Завершить
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && !endAll.isPending && setConfirm(null)}
          title={confirm === 'all' ? 'Выйти везде?' : 'Выйти на остальных устройствах?'}
          desc={confirm === 'all' ? 'Все сессии, включая эту, будут завершены. Вы вернётесь на страницу входа.' : 'Сессии на других устройствах завершатся. Эта останется.'}
          confirmText='Выйти'
          isLoading={endAll.isPending}
          handleConfirm={() => endAll.mutate(confirm === 'all')}
        />
      )}
    </Card>
  )
}

export function Security() {
  const qc = useQueryClient()
  const { data, isError } = useQuery({
    queryKey: ['security'],
    queryFn: async () => (await api.get<SecurityState>('/security')).data,
    refetchInterval: 30_000,
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['security'] })
  return (
    <Page title='Безопасность' description='Двухфакторный вход, доступ из интернета и активные сессии'>
      {isError && <NoData reason='не удалось получить состояние' />}
      {data && (
        <div className='grid items-start gap-4 xl:grid-cols-2'>
          <TotpCard s={data} onChanged={refresh} />
          <ExternalCard s={data} onChanged={refresh} />
          <div className='xl:col-span-2'>
            <SessionsCard s={data} onChanged={refresh} />
          </div>
        </div>
      )}
    </Page>
  )
}
