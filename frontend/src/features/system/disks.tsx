import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  type LucideIcon,
  Moon,
  RefreshCw,
  ShieldCheck,
  ShieldQuestion,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatBytes, formatRelative } from '@/lib/format'
import { percentLevel, tempLevel } from '@/lib/levels'
import type { DiskInfo, DiskIoHistorySnapshot, DiskIoRate, DiskIoSnapshot } from '@/lib/types'
import { cn } from '@/lib/utils'
import { NoData } from '@/components/no-data'
import { type Block, blockId, SortableBlocks } from '@/components/sortable-blocks'
import { Meter } from '@/components/meter'
import { Value } from '@/components/value'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Опрос и точки на графике — оба раз в IO_POLL_MS (1.5 с), чтобы цифры были живыми. Пустой график при
// открытии раздела чинит не это — а готовая история с сервера (см. seed ниже): фоновый сборщик
// (backend/src/system/disk-io.ts) копит буфер НЕПРЕРЫВНО, пока жив процесс сервера, независимо от того,
// открыт ли раздел. Спокойствие линии даёт сглаживание (movingAverage в IoChart) + мягкая кривая + transition.
// Горизонт отображения — 2 минуты (80 точек × 1.5 с); сервер хранит чуть больше (~4 мин) про запас.
const IO_POLL_MS = 1500
const IO_CHART_LEN = 80
// Пара цветов для карточки диска: чтение — тот же голубой, что и rx сети; запись — СВОЙ мягкий оранжевый
// (не --tx, трогать сетевую пару нельзя). Используются ОДНИМ набором констант и в плашках, и на графике,
// и в тултипе — цвет гарантированно совпадает везде.
const DISK_READ_COLOR = 'var(--rx)'
const DISK_WRITE_COLOR = 'var(--disk-write)'

// seed — история с сервера (/system/disks/io-history), забирается ОДИН раз при открытии раздела и сразу
// заполняет график целиком; дальше live-опрос просто дописывает новые точки поверх неё.
function useDiskIoHistory(io: DiskIoSnapshot | undefined, seed: DiskIoHistorySnapshot | undefined) {
  const [history, setHistory] = useState<Record<string, { read: number[]; write: number[] }>>({})
  const seededRef = useRef(false)

  useEffect(() => {
    if (!seed || seededRef.current) return
    seededRef.current = true
    setHistory((prev) => {
      const next = { ...prev }
      for (const [name, points] of Object.entries(seed)) {
        const slice = points.slice(-IO_CHART_LEN)
        next[name] = { read: slice.map((p) => p.readBps), write: slice.map((p) => p.writeBps) }
      }
      return next
    })
  }, [seed])

  useEffect(() => {
    if (!io) return
    setHistory((prev) => {
      const next = { ...prev }
      for (const [name, rate] of Object.entries(io.disks)) {
        const h = next[name]
        // Буфера с сервера ещё может не быть (гонка с seed-запросом) — тогда как раньше, первая точка
        // заполняет весь буфер, чтобы график сразу не менял количество точек на каждом тике.
        next[name] = h
          ? { read: [...h.read, rate.readBps].slice(-IO_CHART_LEN), write: [...h.write, rate.writeBps].slice(-IO_CHART_LEN) }
          : { read: Array(IO_CHART_LEN).fill(rate.readBps), write: Array(IO_CHART_LEN).fill(rate.writeBps) }
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [io?.ts])
  return history
}

// Скользящее среднее — сглаживает резкие скачки между опросами (1.5 с), не трогая сами цифры в плашках
function movingAverage(arr: number[], window = 4) {
  return arr.map((_, i) => {
    const slice = arr.slice(Math.max(0, i - window + 1), i + 1)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
}

// Catmull-Rom → кубический Безье: мягкая кривая через те же точки вместо ломаной
function smoothPath(points: { x: number; y: number }[]) {
  if (points.length < 2) return ''
  if (points.length === 2) return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`
  let d = `M${points[0].x},${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`
  }
  return d
}

function TechCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className='text-muted-foreground'>{label}</div>
      <div className='mt-0.5 font-medium text-foreground'>{children}</div>
    </div>
  )
}

// --- Капсулы статусов (пт.6 ТЗ): единый стиль ok/warn/danger/unknown с иконкой ---
type PillLevel = 'ok' | 'warn' | 'danger' | 'unknown'
const PILL_CLASS: Record<PillLevel, string> = {
  ok: 'bg-ok/12 text-ok-foreground border-ok/25',
  warn: 'bg-warn/12 text-warn-foreground border-warn/25',
  danger: 'bg-danger/12 text-danger-foreground border-danger/25',
  unknown: 'bg-muted text-muted-foreground border-border',
}

function Pill({ level, icon: Icon, title, children }: { level: PillLevel; icon: LucideIcon; title?: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', PILL_CLASS[level])} title={title}>
      <Icon className='size-3 shrink-0' />
      {children}
    </span>
  )
}

// Пт.10 + уточнение пользователя: «спит» — это НЕ «здоров», а «свежих данных нет, и мы намеренно не будим диск».
// Красим и подписываем честно: спящий диск — серый (unknown), а не зелёный.
function diskHealth(d: DiskInfo): { level: PillLevel; icon: LucideIcon; label: string; title: string } {
  if (d.state === 'missing') return { level: 'danger', icon: CircleAlert, label: 'Отвалился', title: 'Диск из fstab не подключён' }
  const s = d.smart
  if (!s) return { level: 'unknown', icon: ShieldQuestion, label: 'Нет данных', title: 'SMART ещё не опрашивался' }
  if (s.status === 'failing') return { level: 'danger', icon: CircleAlert, label: 'Критично', title: 'SMART: диск неисправен' }
  if (s.status === 'standby') {
    return {
      level: 'unknown',
      icon: Moon,
      label: 'Спит',
      title: 'Диск в энергосбережении — SMART намеренно не опрошен, чтобы не изнашивать его. Это не значит, что диск проверен и здоров.',
    }
  }
  if (s.status === 'unavailable') return { level: 'unknown', icon: ShieldQuestion, label: 'Нет данных', title: s.error ?? 'SMART недоступен' }
  if (s.temperature != null) {
    const tl = tempLevel(s.temperature, 'disk')
    if (tl === 'danger') return { level: 'danger', icon: CircleAlert, label: 'Перегрев', title: `${s.temperature} °C — выше порога` }
    if (tl === 'warn') return { level: 'warn', icon: TriangleAlert, label: 'Горячий', title: `${s.temperature} °C — близко к порогу` }
  }
  return { level: 'ok', icon: ShieldCheck, label: 'Отлично', title: 'SMART в норме' }
}

// «N назад» → без слова «назад» (пт.7); совсем недавнее — «Только что»
function checkedAgoShort(ts: number) {
  if (Date.now() - ts < 90_000) return 'Только что'
  return formatRelative(ts).replace(/ назад$/, '')
}

// Пт.3: голый «0 Б/с» неинформативен — ниже порога шума показываем серое «Простой», выше — крупно и цветом потока
const IO_IDLE_THRESHOLD = 1024 // Б/с

// Пт.2.2: плашка — одновременно и показатель, и легенда графика (та же заливка цветом сверху, что и линия),
// и переключатель — клик скрывает/показывает соответствующую линию на графике (стандарт для мониторинга).
function SpeedTile({
  label,
  value,
  color,
  icon: Icon,
  active,
  onToggle,
}: {
  label: string
  value: number
  color: string
  icon: LucideIcon
  active: boolean
  onToggle: () => void
}) {
  const idle = value < IO_IDLE_THRESHOLD
  return (
    <button
      type='button'
      onClick={onToggle}
      className={cn('rounded-lg border bg-card px-3 py-2 text-left transition-opacity', !active && 'opacity-40')}
      style={{ borderTopColor: color, borderTopWidth: 3 }}
      aria-pressed={active}
      title={active ? `Скрыть «${label}» на графике` : `Показать «${label}» на графике`}
    >
      <div className='flex items-center gap-1.5 text-xs font-medium text-muted-foreground'>
        <Icon className='size-3.5 shrink-0' style={!active || idle ? undefined : { color }} />
        {label}
      </div>
      {!active ? (
        <div className='mt-0.5 text-lg font-bold text-muted-foreground'>Скрыто</div>
      ) : idle ? (
        <div className='mt-0.5 text-lg font-bold text-muted-foreground'>Простой</div>
      ) : (
        <div className='mt-0.5 text-lg font-bold tabular-nums' style={{ color }}>
          {formatBytes(value)}/с
        </div>
      )}
    </button>
  )
}

// Площадь под кривой — та же сглаженная линия, замкнутая до нижнего края
function areaPath(points: { x: number; y: number }[]) {
  if (points.length < 2) return ''
  return `${smoothPath(points)} L${points[points.length - 1].x},100 L${points[0].x},100 Z`
}

// Сетка, заливка градиентом, явная нулевая линия внизу (видно, когда активность падает в ноль), ось времени,
// тултип по наведению/тапу (Pointer Events — единые для мыши и тача, на ТВ без курсора просто не сработают,
// но и не сломают карточку). showRead/showWrite — переключение линий из SpeedTile. Точки живые (раз в IO_POLL_MS),
// спокойствие линии — за счёт сильного скользящего среднего (окно 12 ≈ 18 с) + мягкой кривой + transition.
function IoChart({
  read,
  write,
  showRead,
  showWrite,
  className,
}: {
  read: number[]
  write: number[]
  showRead: boolean
  showWrite: boolean
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const smoothRead = movingAverage(read, 12)
  const smoothWrite = movingAverage(write, 12)
  const max = Math.max(1, ...(showRead ? smoothRead : []), ...(showWrite ? smoothWrite : []))
  const toPoints = (arr: number[]) => arr.map((v, i) => ({ x: (i / Math.max(1, arr.length - 1)) * 100, y: 100 - (v / max) * 100 }))
  const readPts = toPoints(smoothRead)
  const writePts = toPoints(smoothWrite)

  const updateHover = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    setHover(Math.round(frac * (read.length - 1)))
  }
  const agoLabel = (i: number) => {
    const sec = Math.round(((read.length - 1 - i) * IO_POLL_MS) / 1000)
    return sec < 60 ? `${sec} с назад` : `${Math.round(sec / 60)} мин назад`
  }
  const horizonSec = (read.length * IO_POLL_MS) / 1000
  const horizonLabel = horizonSec < 60 ? `${Math.round(horizonSec)} сек назад` : `${Math.round(horizonSec / 60)} мин назад`
  const hoverX = hover != null ? readPts[hover]?.x : null

  return (
    <div className={cn('relative', className)}>
      <div
        ref={ref}
        className='h-full w-full'
        onPointerMove={(e) => updateHover(e.clientX)}
        onPointerDown={(e) => updateHover(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <svg viewBox='0 0 100 100' preserveAspectRatio='none' className='h-full w-full overflow-visible'>
          <defs>
            <linearGradient id='io-read-fill' x1='0' y1='0' x2='0' y2='1'>
              <stop offset='0%' stopColor={DISK_READ_COLOR} stopOpacity='0.3' />
              <stop offset='100%' stopColor={DISK_READ_COLOR} stopOpacity='0' />
            </linearGradient>
            <linearGradient id='io-write-fill' x1='0' y1='0' x2='0' y2='1'>
              <stop offset='0%' stopColor={DISK_WRITE_COLOR} stopOpacity='0.3' />
              <stop offset='100%' stopColor={DISK_WRITE_COLOR} stopOpacity='0' />
            </linearGradient>
          </defs>
          {/* едва заметная сетка-ориентир */}
          {[25, 50, 75].map((y) => (
            <line key={y} x1='0' x2='100' y1={y} y2={y} className='text-border' stroke='currentColor' strokeWidth='0.5' vectorEffect='non-scaling-stroke' />
          ))}
          {/* нулевая линия — явно заметнее остальных, чтобы было видно падение активности в ноль */}
          <line x1='0' x2='100' y1='99.3' y2='99.3' className='text-muted-foreground/70' stroke='currentColor' strokeWidth='1' vectorEffect='non-scaling-stroke' />
          {showWrite && <path d={areaPath(writePts)} fill='url(#io-write-fill)' stroke='none' style={{ transition: 'd 0.9s ease-out' }} />}
          {showRead && <path d={areaPath(readPts)} fill='url(#io-read-fill)' stroke='none' style={{ transition: 'd 0.9s ease-out' }} />}
          {showWrite && (
            <path
              d={smoothPath(writePts)}
              fill='none'
              stroke={DISK_WRITE_COLOR}
              strokeWidth='2.5'
              strokeLinecap='round'
              strokeLinejoin='round'
              vectorEffect='non-scaling-stroke'
              style={{ transition: 'd 0.9s ease-out' }}
            />
          )}
          {showRead && (
            <path
              d={smoothPath(readPts)}
              fill='none'
              stroke={DISK_READ_COLOR}
              strokeWidth='2.5'
              strokeLinecap='round'
              strokeLinejoin='round'
              vectorEffect='non-scaling-stroke'
              style={{ transition: 'd 0.9s ease-out' }}
            />
          )}
          {hoverX != null && (
            <line x1={hoverX} x2={hoverX} y1='0' y2='100' className='text-muted-foreground/50' stroke='currentColor' strokeWidth='0.5' strokeDasharray='3,3' vectorEffect='non-scaling-stroke' />
          )}
        </svg>
        {hoverX != null && hover != null && (
          <div
            className='pointer-events-none absolute top-1 z-10 rounded-md border bg-popover px-2 py-1 text-[11px] whitespace-nowrap text-popover-foreground shadow-md'
            style={{ left: `${hoverX}%`, transform: `translateX(${hoverX > 80 ? '-100%' : hoverX < 20 ? '0%' : '-50%'})` }}
          >
            <div className='text-muted-foreground'>{hover === read.length - 1 ? 'сейчас' : agoLabel(hover)}</div>
            {showRead && <div style={{ color: DISK_READ_COLOR }}>чтение {formatBytes(read[hover])}/с</div>}
            {showWrite && <div style={{ color: DISK_WRITE_COLOR }}>запись {formatBytes(write[hover])}/с</div>}
          </div>
        )}
        {/* подпись у нулевой линии */}
        <span className='pointer-events-none absolute -bottom-0.5 left-0 text-[10px] text-muted-foreground'>0</span>
      </div>
      <div className='mt-1.5 flex justify-between text-[10px] text-muted-foreground'>
        <span>{horizonLabel}</span>
        <span>сейчас</span>
      </div>
    </div>
  )
}

// Техническая сетка: фиксированные 3 колонки, моноширинный шрифт, капсулы статусов (пт.6, пт.7); температуру
// без данных просто не показываем (пт.5), а не «нет данных». Порядок специально такой, что ФС/размер, SMART
// и fstab — поля, которые есть у ЛЮБОГО диска — всегда занимают первую строку целиком и не ездят; переменные
// поля (температура/наработка/проверено, бывают не у всех) идут второй строкой, не ломая первую.
function DiskTechGridV2({ d }: { d: DiskInfo }) {
  const s = d.smart
  // Пт.5: честно и коротко — «Спит», без «OK» и без «не опрошен» прямо в ячейке; подробности — в title (тултип)
  const smartPill = !s ? (
    <Pill level='unknown' icon={ShieldQuestion}>
      не опрошен
    </Pill>
  ) : s.status === 'ok' ? (
    <Pill level='ok' icon={ShieldCheck}>
      в норме
    </Pill>
  ) : s.status === 'failing' ? (
    <Pill level='danger' icon={CircleAlert}>
      неисправен
    </Pill>
  ) : s.status === 'standby' ? (
    <Pill level='unknown' icon={Moon} title='Диск спит — SMART намеренно не опрошен, чтобы не будить лишний раз. Это не значит, что диск проверен и здоров.'>
      Спит
    </Pill>
  ) : (
    <Pill level='unknown' icon={ShieldQuestion} title={s.error}>
      недоступен
    </Pill>
  )

  return (
    <div>
      <div className='grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs'>
        <TechCell label='ФС / размер'>
          <span className='font-mono'>
            {d.fstype ?? '—'} · {d.size ? formatBytes(d.size) : '—'}
          </span>
        </TechCell>
        <TechCell label='SMART'>{smartPill}</TechCell>
        <TechCell label='fstab'>
          {d.inFstab ? (
            <Pill level='ok' icon={CircleCheck}>
              да
            </Pill>
          ) : (
            <Pill level='unknown' icon={CircleX}>
              нет
            </Pill>
          )}
        </TechCell>
        {d.smart?.temperature != null && (
          <TechCell label='Температура'>
            <Value kind='temp-disk' value={d.smart.temperature} className='font-mono' />
          </TechCell>
        )}
        {d.smart?.powerOnHours != null && (
          <TechCell label='Наработка'>
            <span className='font-mono'>{Math.round(d.smart.powerOnHours / 24)} дней</span>
          </TechCell>
        )}
        {d.smart && (
          <TechCell label='Проверено'>
            <span className='inline-flex items-center gap-1 font-mono'>
              <Clock className='size-3 text-muted-foreground' />
              {checkedAgoShort(d.smart.checkedAt)}
            </span>
          </TechCell>
        )}
      </div>
      {/* Пт.2.3: путь устройства нужен редко — мелкой серой строкой внизу, как серийный номер в паспорте */}
      <div className='mt-1.5 font-mono text-[10px] text-muted-foreground/70'>{d.device}</div>
    </div>
  )
}

type DiskCardProps = { d: DiskInfo; rate?: DiskIoRate; hist?: { read: number[]; write: number[] } }

// Единый вид карточки диска: крупная цифра объёма, индикатор здоровья (честно отличает «спит» от «ок» —
// см. diskHealth), блоки «Состояние»/«Активность» разделены фоном, интерактивный график с сеткой/заливкой/
// тултипом, капсулы статусов, моноширинная техническая сетка внизу.
function DiskCard({ d, rate, hist }: DiskCardProps) {
  const health = diskHealth(d)
  const [show, setShow] = useState({ read: true, write: true })
  const percentLvl = d.percent != null ? percentLevel(d.percent, 'higher-worse') : null
  // Пт.1 + уточнение: без слова «занято» (гигантская цифра и так читается как занятое), процент — НЕ зелёный
  // (зелёный оставлен только статусу «смонтирован»/«отлично»), разве что заполнение реально критично.
  const percentColor = percentLvl === 'danger' ? 'text-danger-foreground' : percentLvl === 'warn' ? 'text-warn-foreground' : 'text-foreground'
  return (
    <Card className={cn('gap-2.5 rounded-xl py-4', d.state === 'missing' && 'border-danger/50')}>
      <CardHeader className='flex flex-row items-start justify-between gap-2 px-4'>
        <div>
          <CardTitle className='text-sm'>{d.mount ?? d.device}</CardTitle>
          <p className='text-xs text-muted-foreground'>
            {[d.model, d.label && `метка ${d.label}`, d.transport?.toUpperCase()].filter(Boolean).join(' · ') || d.device}
          </p>
        </div>
        {/* Пт.10 + компактность: индикатор здоровья и статус монтирования — в одну строку, не столбиком */}
        <div className='flex shrink-0 flex-wrap items-center justify-end gap-1'>
          <Pill level={health.level} icon={health.icon} title={health.title}>
            {health.label}
          </Pill>
          {d.state === 'missing' ? (
            <Pill level='danger' icon={CircleX}>
              отвалился
            </Pill>
          ) : d.state === 'unmounted' ? (
            <Pill level='warn' icon={TriangleAlert}>
              не смонтирован
            </Pill>
          ) : (
            <Pill level='ok' icon={CircleCheck}>
              смонтирован
            </Pill>
          )}
        </div>
      </CardHeader>
      <CardContent className='space-y-2.5 px-4'>
        {/* Блок «Состояние»: крупная цифра без подписи (и так читается как занятое), процент нейтральным
            цветом рядом (не зелёным — зелёный занят статусом монтирования/здоровья), ниже бара — одна мелкая
            серая строка со свободным местом */}
        {d.percent != null && (
          <div>
            <div className='flex items-baseline gap-2'>
              <div className='text-3xl font-extrabold tabular-nums leading-none'>{formatBytes(d.used, 1)}</div>
              <div className={cn('text-lg font-bold tabular-nums', percentColor)}>{Math.round(d.percent)}%</div>
            </div>
            <Meter value={d.percent} direction='higher-worse' className='mt-1.5 h-1.5' label={`Заполнение ${d.mount ?? d.device}`} />
            {/* Ровно как в уточнении: одна мелкая серая строка, без слова «занято» — цифра выше и так им является */}
            <div className='mt-1 text-xs text-muted-foreground'>
              {formatBytes(d.free)} свободно из {formatBytes(d.size)}
            </div>
          </div>
        )}

        {/* Блок «Активность»: отдельная подложка (пт.2), плашки скорости — легенда и переключатель линий
            (цветная полоса сверху = цвет линии; клик скрывает/показывает, пт.2.2). Высота графика фиксированная —
            карточка плотная, без растягивания. */}
        {(rate || hist) && (
          <div className='space-y-2 rounded-lg bg-muted/25 p-2.5'>
            {rate && (
              <div className='grid grid-cols-2 gap-2'>
                <SpeedTile
                  label='Чтение'
                  value={rate.readBps}
                  color={DISK_READ_COLOR}
                  icon={ArrowDown}
                  active={show.read}
                  onToggle={() => setShow((s) => ({ ...s, read: !s.read }))}
                />
                <SpeedTile
                  label='Запись'
                  value={rate.writeBps}
                  color={DISK_WRITE_COLOR}
                  icon={ArrowUp}
                  active={show.write}
                  onToggle={() => setShow((s) => ({ ...s, write: !s.write }))}
                />
              </div>
            )}
            {hist && <IoChart read={hist.read} write={hist.write} showRead={show.read} showWrite={show.write} className='h-16 w-full' />}
          </div>
        )}

        {/* Низ: техническая сетка, моноширинный шрифт, капсулы вместо голого текста (пт.7) */}
        <div className='border-t pt-2'>
          <DiskTechGridV2 d={d} />
        </div>
      </CardContent>
    </Card>
  )
}

export function Disks() {
  const qc = useQueryClient()
  const { data, isError } = useQuery({
    queryKey: ['disks'],
    queryFn: async () => (await api.get<DiskInfo[]>('/system/disks')).data,
    refetchInterval: 30_000,
  })
  // Live-скорость чтения/записи: быстрый опрос, пока открыт раздел «Диски» — цифры в плашках и график
  // обновляются этим же темпом (IO_POLL_MS).
  const { data: io } = useQuery({
    queryKey: ['disks-io'],
    queryFn: async () => (await api.get<DiskIoSnapshot>('/system/disks/io')).data,
    refetchInterval: IO_POLL_MS,
  })
  // Готовая история с сервера — забирается ОДИН раз при открытии раздела, чтобы график сразу был
  // заполнен тем, что копилось в фоне (см. backend/src/system/disk-io.ts), а не рос с нуля на глазах.
  const { data: ioHistorySeed } = useQuery({
    queryKey: ['disks-io-history'],
    queryFn: async () => (await api.get<DiskIoHistorySnapshot>('/system/disks/io-history')).data,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
  const ioHistory = useDiskIoHistory(io, ioHistorySeed)
  const refresh = useMutation({
    mutationFn: async () => (await api.post<DiskInfo[]>('/system/disks/smart-refresh', {})).data,
    onSuccess: (d) => {
      qc.setQueryData(['disks'], d)
      toast.success('SMART обновлён')
    },
  })

  if (isError) return <NoData reason='не удалось получить список дисков' />

  return (
    <div className='space-y-4'>
      <div className='flex justify-end'>
        <Button size='sm' variant='outline' onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          <RefreshCw className={cn(refresh.isPending && 'animate-spin')} /> Обновить SMART
        </Button>
      </div>
      {/* Id блока — по UUID/точке монтирования: буквы /dev/sdX от перезагрузки к перезагрузке меняются */}
      <SortableBlocks
        grid
        className='grid items-start gap-4 md:grid-cols-2'
        blocks={(data ?? []).map(
          (d): Block => ({
            id: blockId('d', d.uuid ?? d.mount ?? d.device),
            title: d.mount ?? d.device,
            node: (() => {
              const name = d.disk.replace(/^\/dev\//, '')
              const rate = io?.disks[name]
              const hist = ioHistory[name]
              return <DiskCard d={d} rate={rate} hist={hist} />
            })(),
          })
        )}
      />
    </div>
  )
}
