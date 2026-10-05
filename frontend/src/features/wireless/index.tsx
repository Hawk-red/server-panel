import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { Bluetooth, BluetoothSearching, BluetoothOff, Radio, Search, Wifi } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Page } from '@/components/layout/page'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type BtAdapter = { name: string | null; address: string | null; powered: boolean; discoverable: boolean; pairable: boolean }
type BtDevice = {
  mac: string
  name: string
  icon: string | null
  paired: boolean
  trusted: boolean
  blocked: boolean
  connected: boolean
  battery: number | null
  rssi?: number | null
}
type WifiStatus = { present: boolean; chip: string | null; driver: string | null; interfaces: string[]; wiredInterface: string | null }
type Wireless = { bluetooth: { adapter: BtAdapter | null; paired: BtDevice[]; scanning: boolean }; wifi: WifiStatus }

// Иконка из bluetoothctl (Icon: input-gaming, phone, audio-headset...). Неизвестное — общий значок.
const KIND: Record<string, string> = {
  'input-gaming': 'геймпад / джойстик',
  'input-keyboard': 'клавиатура',
  'input-mouse': 'мышь',
  'input-tablet': 'планшет',
  phone: 'телефон',
  computer: 'компьютер',
  'audio-headset': 'гарнитура',
  'audio-headphones': 'наушники',
  'audio-card': 'аудио',
  'camera-photo': 'камера',
  'printer': 'принтер',
}

const SCAN_SECONDS = 20

function DeviceRow({ d }: { d: BtDevice }) {
  return (
    <div className='flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm'>
      <div className='min-w-0'>
        <div className='truncate font-medium'>{d.name}</div>
        <div className='font-mono text-xs text-muted-foreground'>
          {d.mac}
          {d.icon && <> · {KIND[d.icon] ?? d.icon}</>}
        </div>
      </div>
      <div className='flex flex-wrap items-center gap-2 text-xs'>
        <StatusBadge status={d.connected ? 'ok' : 'unknown'} label={d.connected ? 'подключено' : 'не подключено'} />
        {d.trusted && <span className='rounded bg-muted px-1.5 py-0.5 text-muted-foreground'>доверенное</span>}
        {d.blocked && <span className='rounded bg-danger/15 px-1.5 py-0.5 text-danger-foreground'>заблокировано</span>}
        {d.battery != null && <span className='tabular-nums text-muted-foreground'>батарея {d.battery}%</span>}
      </div>
    </div>
  )
}

function ScanPanel({ paired, onFound }: { paired: string[]; onFound: () => void }) {
  const [found, setFound] = useState<BtDevice[] | null>(null)
  const [started, setStarted] = useState(0)
  const [now, setNow] = useState(0)
  const scan = useMutation({
    // Сканирование длится 20 с: глобальный таймаут axios (15 с) здесь не подходит
    mutationFn: async () => (await api.post<{ found: BtDevice[] }>('/wireless/bluetooth/scan', {}, { timeout: 60_000 })).data,
    onMutate: () => {
      setStarted(Date.now())
      setNow(Date.now())
      setFound(null)
    },
    onSuccess: (d) => {
      setFound(d.found)
      onFound()
    },
    onError: (e) => {
      toast.error((e instanceof AxiosError && e.response?.data?.message) || 'сканирование не удалось')
      onFound()
    },
  })

  useEffect(() => {
    if (!scan.isPending) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [scan.isPending])

  const left = Math.max(0, SCAN_SECONDS - Math.floor((now - started) / 1000))

  return (
    <div className='space-y-2'>
      <div className='flex flex-wrap items-center gap-3'>
        <Button size='sm' variant='outline' onClick={() => scan.mutate()} disabled={scan.isPending}>
          <Search /> Сканировать {SCAN_SECONDS} с
        </Button>
        {scan.isPending && (
          <span className='flex items-center gap-2 text-sm text-muted-foreground'>
            <BluetoothSearching className='size-4 animate-pulse' /> идёт сканирование… {left} с
          </span>
        )}
      </div>
      {found && (
        <div className='space-y-1.5'>
          <p className='text-xs text-muted-foreground'>
            Найдено за {SCAN_SECONDS} с: {found.length}. Устройства из панели не спариваются, это только просмотр.
          </p>
          {found.length === 0 && <p className='text-sm text-muted-foreground'>поблизости ничего не найдено</p>}
          {found.map((d) => (
            <div key={d.mac} className='flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm'>
              <div className='min-w-0'>
                <div className='truncate'>{d.name === d.mac ? 'без имени' : d.name}</div>
                <div className='font-mono text-xs text-muted-foreground'>{d.mac}</div>
              </div>
              <div className='flex items-center gap-2 text-xs text-muted-foreground'>
                {d.rssi != null && <span className='tabular-nums'>{d.rssi} dBm</span>}
                {paired.includes(d.mac) && <span className='rounded bg-ok/15 px-1.5 py-0.5 text-ok-foreground'>уже спарено</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Wireless() {
  const qc = useQueryClient()
  const [confirmOff, setConfirmOff] = useState(false)
  const { data, isError, isPending } = useQuery({
    queryKey: ['wireless'],
    queryFn: async () => (await api.get<Wireless>('/wireless')).data,
    refetchInterval: 15_000,
  })
  const power = useMutation({
    mutationFn: async (on: boolean) => (await api.post('/wireless/bluetooth/power', { on }, { timeout: 30_000 })).data,
    onSuccess: (_d, on) => {
      toast.success(on ? 'Bluetooth включён' : 'Bluetooth выключен')
      setConfirmOff(false)
      qc.invalidateQueries({ queryKey: ['wireless'] })
    },
    onError: (e) => {
      toast.error((e instanceof AxiosError && e.response?.data?.message) || 'не удалось переключить Bluetooth')
      setConfirmOff(false)
    },
  })

  const adapter = data?.bluetooth.adapter
  const paired = data?.bluetooth.paired ?? []
  const connected = paired.filter((d) => d.connected)
  const wifi = data?.wifi
  const wifiText = !wifi
    ? null
    : !wifi.present
      ? 'Wi-Fi адаптер не найден в системе.'
      : wifi.interfaces.length === 0
        ? `Wi-Fi адаптер есть (${wifi.chip ?? 'Broadcom BCM4360'}), но драйвер не установлен, не используется — сервер работает по кабелю.`
        : `Wi-Fi адаптер работает: интерфейс ${wifi.interfaces.join(', ')}.`

  return (
    <Page title='Беспроводные' description='Bluetooth и Wi-Fi адаптеры Mac Mini'>
      {isError && <p className='text-sm text-danger-foreground'>Не удалось получить состояние беспроводных адаптеров.</p>}
      <div className='grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'>
        <Card className='gap-4'>
          <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-2'>
            <CardTitle className='flex items-center gap-2 text-sm font-medium'>
              <Bluetooth className='size-4 text-info' /> Bluetooth
            </CardTitle>
            <div className='flex items-center gap-3'>
              {adapter && <StatusBadge status={adapter.powered ? 'ok' : 'unknown'} label={adapter.powered ? 'включён' : 'выключен'} />}
              {adapter && (
                <Button
                  size='sm'
                  variant={adapter.powered ? 'destructive' : 'outline'}
                  disabled={power.isPending || isPending}
                  onClick={() => (adapter.powered ? setConfirmOff(true) : power.mutate(true))}
                >
                  {adapter.powered ? <BluetoothOff /> : <Bluetooth />} {adapter.powered ? 'Выключить' : 'Включить'}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className='space-y-5'>
            {!adapter && !isPending && <p className='text-sm text-muted-foreground'>Bluetooth-адаптер не найден или служба не запущена.</p>}
            {adapter && (
              <p className='text-xs text-muted-foreground'>
                {adapter.name} · <span className='font-mono'>{adapter.address}</span> · видимость: {adapter.discoverable ? 'да' : 'нет'} · спаривание:{' '}
                {adapter.pairable ? 'разрешено' : 'закрыто'}
              </p>
            )}

            <div className='space-y-2'>
              <h3 className='text-sm font-medium'>Подключено сейчас: {connected.length}</h3>
              {connected.length === 0 && <p className='text-sm text-muted-foreground'>ни одно устройство не подключено</p>}
              {connected.map((d) => (
                <DeviceRow key={d.mac} d={d} />
              ))}
            </div>

            <div className='space-y-2'>
              <h3 className='text-sm font-medium'>Спаренные устройства: {paired.length}</h3>
              {paired.length === 0 && <p className='text-sm text-muted-foreground'>спаренных устройств нет</p>}
              {paired.filter((d) => !d.connected).map((d) => (
                <DeviceRow key={d.mac} d={d} />
              ))}
            </div>

            <div className='space-y-2 border-t pt-4'>
              <h3 className='flex items-center gap-2 text-sm font-medium'>
                <Radio className='size-4' /> Поиск поблизости
              </h3>
              <ScanPanel paired={paired.map((d) => d.mac)} onFound={() => qc.invalidateQueries({ queryKey: ['wireless'] })} />
            </div>
          </CardContent>
        </Card>

        <Card className='gap-3'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-sm font-medium'>
              <Wifi className='size-4 text-info' /> Wi-Fi
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-3 text-sm'>
            {wifi && (
              <StatusBadge status={wifi.interfaces.length ? 'ok' : 'unknown'} label={wifi.interfaces.length ? 'работает' : 'не используется'} />
            )}
            {wifiText && <p>{wifiText}</p>}
            {wifi?.present && (
              <dl className={cn('grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs')}>
                <dt className='text-muted-foreground'>Адаптер</dt>
                <dd>{wifi.chip}</dd>
                <dt className='text-muted-foreground'>Драйвер ядра</dt>
                <dd>{wifi.driver ?? 'не загружен'}</dd>
              </dl>
            )}
            <p className='text-xs text-muted-foreground'>
              Сетевое подключение сервера: {wifi?.wiredInterface ? `кабель (${wifi.wiredInterface})` : 'нет маршрута по умолчанию'}.
            </p>
          </CardContent>
        </Card>
      </div>

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
    </Page>
  )
}
