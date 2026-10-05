import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import {
  Battery,
  Bluetooth,
  BluetoothSearching,
  Check,
  Eye,
  EyeOff,
  Gamepad2,
  Headphones,
  Keyboard,
  Laptop,
  Lock,
  Mouse,
  Radio,
  RefreshCw,
  Search,
  Smartphone,
  Speaker,
  Tablet,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Page } from '@/components/layout/page'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

// ---------- типы ----------
type BtAdapter = { name: string | null; address: string | null; powered: boolean; discoverable: boolean; pairable: boolean }
type BtDevice = { mac: string; name: string; icon: string | null; paired: boolean; trusted: boolean; blocked: boolean; connected: boolean; battery: number | null; rssi?: number | null }
type WifiNetwork = { ssid: string; signal: number; bands: ('2.4' | '5')[]; channel: number | null; secured: boolean; saved: boolean; savedUuid: string | null; connected: boolean }
type WifiState = {
  radio: boolean
  device: string | null
  connected: boolean
  ssid: string | null
  savedUuid: string | null
  ip: string | null
  primaryInterface: string | null
  networks: WifiNetwork[]
}
type Wireless = { bluetooth: { adapter: BtAdapter | null; paired: BtDevice[]; scanning: boolean }; wifi: WifiState }

const SCAN_SECONDS = 20
const LONG = { timeout: 100_000 } // подключение Wi-Fi: nmcli ждёт до 45 с

// ---------- индикаторы ----------
// Четыре столбика сигнала, как в GNOME/iOS: уровень 0–4
function SignalBars({ level, className }: { level: number; className?: string }) {
  return (
    <span className={cn('inline-flex h-4 items-end gap-0.5', className)} role='img' aria-label={`уровень сигнала ${level} из 4`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={cn('w-1 rounded-sm', i === 1 ? 'h-1.5' : i === 2 ? 'h-2.5' : i === 3 ? 'h-3.5' : 'h-4', i <= level ? 'bg-foreground' : 'bg-muted-foreground/25')} />
      ))}
    </span>
  )
}
const wifiLevel = (signal: number) => (signal >= 75 ? 4 : signal >= 50 ? 3 : signal >= 25 ? 2 : signal > 0 ? 1 : 0)
// Bluetooth RSSI (dBm): чем ближе к нулю, тем сильнее
const btLevel = (rssi: number | null | undefined) => (rssi == null ? 0 : rssi >= -60 ? 4 : rssi >= -70 ? 3 : rssi >= -80 ? 2 : 1)

// Иконка по типу устройства (значение Icon из bluetoothctl)
const KIND: Record<string, { label: string; Icon: typeof Bluetooth }> = {
  'input-gaming': { label: 'геймпад / джойстик', Icon: Gamepad2 },
  'input-keyboard': { label: 'клавиатура', Icon: Keyboard },
  'input-mouse': { label: 'мышь', Icon: Mouse },
  'input-tablet': { label: 'планшет', Icon: Tablet },
  phone: { label: 'телефон', Icon: Smartphone },
  computer: { label: 'компьютер', Icon: Laptop },
  'audio-headset': { label: 'гарнитура', Icon: Headphones },
  'audio-headphones': { label: 'наушники', Icon: Headphones },
  'audio-card': { label: 'аудио', Icon: Speaker },
}
const kindOf = (icon: string | null) => KIND[icon ?? ''] ?? { label: 'устройство', Icon: Bluetooth }

function BatteryPill({ level }: { level: number }) {
  const tone = level <= 15 ? 'text-danger-foreground' : level <= 30 ? 'text-warn-foreground' : 'text-muted-foreground'
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs tabular-nums', tone)}>
      <Battery className='size-3.5' /> {level}%
    </span>
  )
}

// ---------- Wi-Fi ----------
function PasswordDialog({ net, onClose }: { net: WifiNetwork | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [psk, setPsk] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const connect = useMutation({
    mutationFn: async () => (await api.post('/wireless/wifi/connect', { ssid: net!.ssid, psk }, LONG)).data,
    onSuccess: () => {
      toast.success(`Подключено к ${net!.ssid} (резервный канал)`)
      setPsk('')
      setError(null)
      onClose()
      qc.invalidateQueries({ queryKey: ['wireless'] })
    },
    onError: (e) => setError((e instanceof AxiosError && e.response?.data?.message) || 'не удалось подключиться'),
  })
  return (
    <Dialog open={net !== null} onOpenChange={(o) => {
        if (!o && !connect.isPending) {
          setPsk('')
          setError(null)
          onClose()
        }
      }}>
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle>Подключиться к «{net?.ssid}»</DialogTitle>
          <DialogDescription>
            Сеть подключится как резервный канал. Основной маршрут останется за кабелем, пароль сохранится на сервере.
          </DialogDescription>
        </DialogHeader>
        <form
          className='space-y-3'
          onSubmit={(e) => {
            e.preventDefault()
            if (psk.length >= 8) connect.mutate()
          }}
        >
          <Label htmlFor='wifi-psk'>Пароль</Label>
          <div className='relative'>
            <Input id='wifi-psk' type={show ? 'text' : 'password'} autoComplete='off' value={psk} onChange={(e) => setPsk(e.target.value)} autoFocus className='pr-10' />
            <button type='button' onClick={() => setShow(!show)} className='absolute inset-y-0 right-2 flex items-center text-muted-foreground' aria-label={show ? 'скрыть пароль' : 'показать пароль'}>
              {show ? <EyeOff className='size-4' /> : <Eye className='size-4' />}
            </button>
          </div>
          {error && <p className='text-sm text-danger-foreground'>{error}</p>}
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose} disabled={connect.isPending}>
              Отмена
            </Button>
            <Button type='submit' disabled={psk.length < 8 || connect.isPending}>
              {connect.isPending ? 'Подключаю…' : 'Подключиться'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function NetworkRow({ n, busy, onPick }: { n: WifiNetwork; busy: boolean; onPick: (n: WifiNetwork) => void }) {
  return (
    <button
      type='button'
      disabled={busy || n.connected}
      onClick={() => onPick(n)}
      className={cn(
        'flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
        n.connected ? 'bg-ok/10' : 'hover:bg-muted/60',
        'disabled:cursor-default disabled:opacity-100'
      )}
    >
      <SignalBars level={wifiLevel(n.signal)} />
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <span className='truncate font-medium'>{n.ssid}</span>
          {n.secured && <Lock className='size-3.5 shrink-0 text-muted-foreground' aria-label='защищённая сеть' />}
        </div>
        <div className='flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground'>
          {n.bands.map((b) => (
            <span key={b} className='rounded bg-muted px-1.5 py-0.5'>
              {b} ГГц
            </span>
          ))}
          {n.channel != null && <span>канал {n.channel}</span>}
          {n.saved && <span>сохранено</span>}
        </div>
      </div>
      {n.connected ? (
        <span className='flex shrink-0 items-center gap-1 rounded-full bg-ok/15 px-2.5 py-1 text-xs font-medium text-ok-foreground'>
          <Check className='size-3.5' /> подключено
        </span>
      ) : (
        <span className='shrink-0 text-xs text-muted-foreground'>{busy ? 'подключаю…' : n.saved ? 'подключить' : n.secured ? '' : 'открытая'}</span>
      )}
    </button>
  )
}

function WifiCard({ wifi }: { wifi: WifiState }) {
  const qc = useQueryClient()
  const [pick, setPick] = useState<WifiNetwork | null>(null)
  const [forgetOpen, setForgetOpen] = useState(false)
  const [offOpen, setOffOpen] = useState(false)
  const busyMsg = (e: unknown, fb: string) => (e instanceof AxiosError && e.response?.data?.message) || fb
  const refresh = () => qc.invalidateQueries({ queryKey: ['wireless'] })

  const radio = useMutation({
    mutationFn: async (on: boolean) => (await api.post('/wireless/wifi/radio', { on }, LONG)).data,
    onSuccess: (_d, on) => {
      toast.success(on ? 'Wi-Fi включён' : 'Wi-Fi выключен')
      setOffOpen(false)
      refresh()
    },
    onError: (e) => {
      toast.error(busyMsg(e, 'не удалось переключить Wi-Fi'))
      setOffOpen(false)
    },
  })
  const connectSaved = useMutation({
    mutationFn: async (uuid: string) => (await api.post('/wireless/wifi/connect-saved', { uuid }, LONG)).data,
    onSuccess: () => {
      toast.success('Подключено (резервный канал)')
      refresh()
    },
    onError: (e) => toast.error(busyMsg(e, 'не удалось подключиться')),
  })
  const forget = useMutation({
    mutationFn: async (uuid: string) => (await api.post('/wireless/wifi/forget', { uuid }, LONG)).data,
    onSuccess: () => {
      toast.success('Сеть забыта')
      setForgetOpen(false)
      refresh()
    },
    onError: (e) => {
      toast.error(busyMsg(e, 'не удалось забыть сеть'))
      setForgetOpen(false)
    },
  })
  const disconnect = useMutation({
    mutationFn: async () => (await api.post('/wireless/wifi/disconnect', {}, LONG)).data,
    onSuccess: () => {
      toast.success('Wi-Fi отключён')
      refresh()
    },
    onError: (e) => toast.error(busyMsg(e, 'не удалось отключиться')),
  })
  const rescan = useMutation({
    mutationFn: async () => (await api.post('/wireless/wifi/rescan', {}, { timeout: 30_000 })).data,
    onSuccess: refresh,
    onError: (e) => toast.error(busyMsg(e, 'не удалось обновить список')),
  })

  const current = wifi.networks.find((n) => n.connected) ?? null
  const primaryCable = wifi.primaryInterface === 'enp3s0f0'
  const busy = connectSaved.isPending || disconnect.isPending

  const connectNew = useMutation({
    mutationFn: async (n: WifiNetwork) => (await api.post('/wireless/wifi/connect', { ssid: n.ssid, psk: '' }, LONG)).data,
    onSuccess: () => {
      toast.success('Подключено (резервный канал)')
      refresh()
    },
    onError: (e) => toast.error(busyMsg(e, 'не удалось подключиться')),
  })

  const onPick = (n: WifiNetwork) => {
    if (n.saved && n.savedUuid) connectSaved.mutate(n.savedUuid)
    else if (!n.secured) connectNew.mutate(n)
    else setPick(n)
  }
  return (
    <Card className='gap-4'>
      <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-3'>
        <CardTitle className='flex items-center gap-2 text-sm font-medium'>
          <Wifi className='size-4 text-info' /> Wi-Fi
        </CardTitle>
        <div className='flex items-center gap-3'>
          <span className='text-sm text-muted-foreground'>{wifi.radio ? 'включён' : 'выключен'}</span>
          <Switch
            aria-label='Wi-Fi'
            checked={wifi.radio}
            disabled={radio.isPending}
            onCheckedChange={(on) => (on ? radio.mutate(true) : setOffOpen(true))}
          />
        </div>
      </CardHeader>

      <CardContent className='space-y-4'>
        {/* Статус: к чему подключён и какой канал основной */}
        <div className='rounded-lg border bg-card p-3'>
          {wifi.connected && current ? (
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <div className='flex items-center gap-3'>
                <SignalBars level={wifiLevel(current.signal)} />
                <div>
                  <div className='font-medium'>{current.ssid}</div>
                  <div className='text-xs text-muted-foreground tabular-nums'>
                    IP {wifi.ip ?? '—'} · сигнал {current.signal}%
                  </div>
                </div>
              </div>
              <div className='flex gap-2'>
                <Button size='sm' variant='outline' onClick={() => disconnect.mutate()} disabled={busy}>
                  <WifiOff /> Отключиться
                </Button>
                {current.saved && (
                  <Button size='sm' variant='ghost' onClick={() => setForgetOpen(true)} disabled={busy}>
                    Забыть
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className='text-sm text-muted-foreground'>
              {wifi.radio ? (wifi.device === 'connecting' ? 'Подключаюсь…' : 'Не подключено к сети') : 'Wi-Fi выключен'}
            </p>
          )}
          <div className='mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-xs'>
            <span className='text-muted-foreground'>Основной маршрут:</span>
            <StatusBadge
              status={primaryCable ? 'ok' : 'warning'}
              label={primaryCable ? 'кабель (enp3s0f0)' : wifi.primaryInterface ? `${wifi.primaryInterface}` : 'нет маршрута'}
            />
            <span className='text-muted-foreground'>· Wi-Fi работает как резервный канал</span>
          </div>
        </div>

        {/* Список сетей */}
        {wifi.radio ? (
          <div className='space-y-1'>
            <div className='flex items-center justify-between px-1 pb-1'>
              <h3 className='text-sm font-medium'>Сети рядом: {wifi.networks.length}</h3>
              <Button size='sm' variant='ghost' onClick={() => rescan.mutate()} disabled={rescan.isPending}>
                <RefreshCw className={cn(rescan.isPending && 'animate-spin')} /> Обновить
              </Button>
            </div>
            {wifi.networks.length === 0 && <p className='px-1 text-sm text-muted-foreground'>сети не найдены, попробуйте обновить</p>}
            <div className='max-h-[60vh] space-y-0.5 overflow-y-auto pr-1'>
              {wifi.networks.map((n) => (
                <NetworkRow key={n.ssid} n={n} busy={connectSaved.isPending || connectNew.isPending} onPick={onPick} />
              ))}
            </div>
          </div>
        ) : (
          <p className='text-sm text-muted-foreground'>Включите Wi-Fi, чтобы увидеть сети рядом.</p>
        )}
      </CardContent>

      <PasswordDialog net={pick} onClose={() => setPick(null)} />

      <ConfirmDialog
        open={forgetOpen}
        onOpenChange={(o) => !o && !forget.isPending && setForgetOpen(false)}
        title={`Забыть «${current?.ssid ?? ''}»?`}
        desc={<p>Сохранённый пароль будет удалён с сервера. Чтобы подключиться снова, понадобится пароль.</p>}
        confirmText='Забыть'
        destructive
        isLoading={forget.isPending}
        handleConfirm={() => current?.savedUuid && forget.mutate(current.savedUuid)}
      />
      <ConfirmDialog
        open={offOpen}
        onOpenChange={(o) => !o && !radio.isPending && setOffOpen(false)}
        title='Выключить Wi-Fi?'
        desc={<p>{wifi.connected ? 'Текущее Wi-Fi-подключение разорвётся. Кабель не затрагивается, основной маршрут остаётся за ним.' : 'Wi-Fi будет выключен.'}</p>}
        confirmText='Выключить'
        destructive
        isLoading={radio.isPending}
        handleConfirm={() => radio.mutate(false)}
      />
    </Card>
  )
}

// ---------- Bluetooth ----------
function BtDeviceCard({ d }: { d: BtDevice }) {
  const { label, Icon } = kindOf(d.icon)
  return (
    <div className='flex items-center gap-3 rounded-lg border bg-card px-3 py-3'>
      <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', d.connected ? 'bg-ok/15 text-ok-foreground' : 'bg-muted text-muted-foreground')}>
        <Icon className='size-5' />
      </div>
      <div className='min-w-0 flex-1'>
        <div className='truncate font-medium'>{d.name}</div>
        <div className='truncate text-xs text-muted-foreground'>
          {label} · <span className='font-mono'>{d.mac}</span>
        </div>
      </div>
      <div className='flex shrink-0 flex-col items-end gap-1'>
        <StatusBadge status={d.connected ? 'ok' : 'unknown'} label={d.connected ? 'подключено' : 'не подключено'} />
        <div className='flex items-center gap-2'>
          {d.battery != null && <BatteryPill level={d.battery} />}
          {d.trusted && <span className='text-[11px] text-muted-foreground'>доверенное</span>}
          {d.blocked && <span className='text-[11px] text-danger-foreground'>заблокировано</span>}
        </div>
      </div>
    </div>
  )
}

function BluetoothCard({ bt }: { bt: Wireless['bluetooth'] }) {
  const qc = useQueryClient()
  const [confirmOff, setConfirmOff] = useState(false)
  const [found, setFound] = useState<BtDevice[] | null>(null)
  const [started, setStarted] = useState(0)
  const [now, setNow] = useState(0)
  const adapter = bt.adapter
  const paired = bt.paired
  const connected = paired.filter((d) => d.connected)
  const others = paired.filter((d) => !d.connected)
  const refresh = () => qc.invalidateQueries({ queryKey: ['wireless'] })

  const power = useMutation({
    mutationFn: async (on: boolean) => (await api.post('/wireless/bluetooth/power', { on }, { timeout: 30_000 })).data,
    onSuccess: (_d, on) => {
      toast.success(on ? 'Bluetooth включён' : 'Bluetooth выключен')
      setConfirmOff(false)
      refresh()
    },
    onError: (e) => {
      toast.error((e instanceof AxiosError && e.response?.data?.message) || 'не удалось переключить Bluetooth')
      setConfirmOff(false)
    },
  })
  const scan = useMutation({
    mutationFn: async () => (await api.post<{ found: BtDevice[] }>('/wireless/bluetooth/scan', {}, { timeout: 60_000 })).data,
    onMutate: () => {
      setStarted(Date.now())
      setNow(Date.now())
      setFound(null)
    },
    onSuccess: (d) => {
      setFound(d.found)
      refresh()
    },
    onError: (e) => {
      toast.error((e instanceof AxiosError && e.response?.data?.message) || 'сканирование не удалось')
      refresh()
    },
  })
  useEffect(() => {
    if (!scan.isPending) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [scan.isPending])

  const left = Math.max(0, SCAN_SECONDS - Math.floor((now - started) / 1000))
  const pairedMacs = new Set(paired.map((d) => d.mac))

  return (
    <Card className='gap-4'>
      <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-3'>
        <CardTitle className='flex items-center gap-2 text-sm font-medium'>
          <Bluetooth className='size-4 text-info' /> Bluetooth
        </CardTitle>
        <div className='flex items-center gap-3'>
          {adapter && <span className='text-sm text-muted-foreground'>{adapter.powered ? 'включён' : 'выключен'}</span>}
          {adapter && (
            <Switch
              aria-label='Bluetooth'
              checked={adapter.powered}
              disabled={power.isPending}
              onCheckedChange={(on) => (on ? power.mutate(true) : setConfirmOff(true))}
            />
          )}
        </div>
      </CardHeader>

      <CardContent className='space-y-5'>
        {!adapter && <p className='text-sm text-muted-foreground'>Bluetooth-адаптер не найден или служба не запущена.</p>}
        {adapter && adapter.powered === false && <p className='text-sm text-muted-foreground'>Bluetooth выключен. Включите, чтобы видеть устройства.</p>}

        {adapter?.powered && (
          <>
            <section className='space-y-2'>
              <h3 className='text-sm font-medium'>Подключено: {connected.length}</h3>
              {connected.length === 0 && <p className='text-sm text-muted-foreground'>ни одно устройство не подключено</p>}
              {connected.map((d) => (
                <BtDeviceCard key={d.mac} d={d} />
              ))}
            </section>

            <section className='space-y-2'>
              <h3 className='text-sm font-medium'>Спаренные: {others.length}</h3>
              {others.length === 0 && <p className='text-sm text-muted-foreground'>спаренных устройств нет</p>}
              {others.map((d) => (
                <BtDeviceCard key={d.mac} d={d} />
              ))}
            </section>

            <section className='space-y-2 border-t pt-4'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <h3 className='flex items-center gap-2 text-sm font-medium'>
                  <Radio className='size-4' /> Поиск поблизости
                </h3>
                <Button size='sm' variant='outline' onClick={() => scan.mutate()} disabled={scan.isPending}>
                  <Search /> Сканировать {SCAN_SECONDS} с
                </Button>
              </div>
              {scan.isPending && (
                <p className='flex items-center gap-2 text-sm text-muted-foreground'>
                  <BluetoothSearching className='size-4 animate-pulse' /> идёт сканирование… {left} с
                </p>
              )}
              {found && (
                <>
                  <p className='text-xs text-muted-foreground'>
                    Найдено за {SCAN_SECONDS} с: {found.length}. Устройства отсюда не спариваются, это только просмотр.
                  </p>
                  {found.length === 0 && <p className='text-sm text-muted-foreground'>поблизости ничего не найдено</p>}
                  {found.map((d) => {
                    const { Icon, label } = kindOf(d.icon)
                    return (
                      <div key={d.mac} className='flex items-center gap-3 rounded-lg px-3 py-2'>
                        <Icon className='size-4 shrink-0 text-muted-foreground' aria-label={label} />
                        <div className='min-w-0 flex-1'>
                          <div className='truncate text-sm'>{d.name === d.mac || d.name === 'без имени' ? 'без имени' : d.name}</div>
                          <div className='font-mono text-[11px] text-muted-foreground'>{d.mac}</div>
                        </div>
                        {pairedMacs.has(d.mac) && <span className='text-[11px] text-ok-foreground'>уже спарено</span>}
                        <SignalBars level={btLevel(d.rssi)} />
                      </div>
                    )
                  })}
                </>
              )}
            </section>
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmOff}
        onOpenChange={(o) => !o && !power.isPending && setConfirmOff(false)}
        title='Выключить Bluetooth?'
        desc={<p>Все подключённые Bluetooth-устройства отключатся. Спаренные устройства останутся в списке.</p>}
        confirmText='Выключить'
        destructive
        isLoading={power.isPending}
        handleConfirm={() => power.mutate(false)}
      />
    </Card>
  )
}

// ---------- страница ----------
export function Wireless() {
  const { data, isError, isPending } = useQuery({
    queryKey: ['wireless'],
    queryFn: async () => (await api.get<Wireless>('/wireless')).data,
    refetchInterval: 20_000,
  })

  return (
    <Page title='Беспроводные' description='Wi-Fi (резервный канал) и Bluetooth на Mac Mini'>
      {isError && <p className='mb-4 text-sm text-danger-foreground'>Не удалось получить состояние беспроводных адаптеров.</p>}
      {isPending && <p className='mb-4 text-sm text-muted-foreground'>Загружаю…</p>}
      {data && (
        <div className='grid gap-4 lg:grid-cols-2'>
          <WifiCard wifi={data.wifi} />
          <BluetoothCard bt={data.bluetooth} />
        </div>
      )}
    </Page>
  )
}
