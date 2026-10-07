import { lazy, Suspense, useEffect, useState } from 'react'
import { Plane } from 'lucide-react'
import type { AlertStats } from '@/lib/types'
import { Button } from '@/components/ui/button'

const StatsBars = lazy(() => import('./alert-charts').then((m) => ({ default: m.StatsBars })))

type BlockKey = 'chart' | 'missiles' | 'pause'
const BLOCKS: { key: BlockKey; label: string }[] = [
  { key: 'chart', label: 'Диаграмма' },
  { key: 'missiles', label: 'Только ракеты' },
  { key: 'pause', label: 'Без ракет' },
]
const LS_KEY = 'alert.statsBlocks'

// Выбор показанных блоков помним в localStorage (если недоступен — по умолчанию показано всё)
function loadBlocks(): Record<BlockKey, boolean> {
  const all = { chart: true, missiles: true, pause: true }
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')
    return { chart: v.chart !== false, missiles: v.missiles !== false, pause: v.pause !== false }
  } catch {
    return all
  }
}

const DAY = 86_400_000
const HOUR = 3_600_000
const dayWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'день' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'дня' : 'дней')
const days = (n: number) => `${n % 1 ? n.toFixed(1).replace('.', ',') : n} ${dayWord(Math.floor(n))}`

function Swatch({ hatch }: { hatch?: boolean }) {
  return (
    <span
      aria-hidden
      className='inline-block h-3 w-3 shrink-0 rounded-sm border'
      style={
        hatch
          ? { borderColor: 'var(--destructive)', background: 'repeating-linear-gradient(135deg, var(--destructive) 0 2px, transparent 2px 5px)' }
          : { background: 'var(--info)', borderColor: 'var(--info)' }
      }
    />
  )
}

function Fallback() {
  return <div className='h-36' />
}

function PauseBlock({ s, now }: { s: AlertStats; now: number }) {
  const last = s.lastMissile
  const p = s.pauses
  const sinceMs = last ? Math.max(0, now - last.ts) : null
  const curDays = sinceMs != null ? sinceMs / DAY : null
  let verdict: string | null = null
  if (curDays != null && p.median != null && p.max != null) {
    verdict =
      curDays > p.max
        ? 'текущая пауза выше максимума — рекордно долгая'
        : curDays > p.median
          ? 'текущая пауза выше нормы'
          : 'текущая пауза ниже нормы'
  }
  const maxBar = Math.max(1, ...p.last.map((g) => g.days))
  const strat = s.lastStrategic
  const stratAgo = strat ? now - strat.ts : null
  return (
    <div className='space-y-2 rounded-lg border p-3'>
      <div className='text-xs text-muted-foreground'>Без ракет</div>
      {sinceMs != null ? (
        <div className='text-3xl font-bold tabular-nums sm:text-4xl' aria-live='polite'>
          {Math.floor(sinceMs / DAY)} дн. {Math.floor((sinceMs % DAY) / HOUR)} ч
        </div>
      ) : (
        <div className='text-xl font-semibold'>ракет в данных нет</div>
      )}
      {last && <div className='text-xs text-muted-foreground'>последняя ракета: {new Date(last.ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>}
      {p.median != null && p.max != null && (
        <div className='text-sm'>
          обычная пауза {days(p.median)}, максимум {days(p.max)}
          {verdict && <> · <b>{verdict}</b></>}
        </div>
      )}
      {p.last.length > 0 && (
        <div>
          <div className='mb-1 text-xs text-muted-foreground'>Последние паузы между ракетными днями, дней</div>
          <div className='flex items-end gap-1 overflow-x-auto pb-1' role='list'>
            {p.last.map((g) => (
              <div key={g.to} role='listitem' className='flex w-7 shrink-0 flex-col items-center gap-0.5' title={`${g.from} → ${g.to}: ${days(g.days)}`}>
                <div className='w-full rounded-sm border' style={{ height: 6 + (g.days / maxBar) * 34, borderColor: 'var(--info)', background: 'color-mix(in oklab, var(--info) 55%, transparent)' }} />
                <span className='text-[10px] tabular-nums'>{g.days}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {strat && stratAgo != null && (
        <div className='flex items-start gap-1.5 text-sm'>
          <Plane className='mt-0.5 h-4 w-4 shrink-0' aria-hidden />
          <span>
            вылет стратегической авиации (Ту-95/Ту-160/МіГ-31К):{' '}
            {stratAgo < 48 * HOUR ? `${Math.max(1, Math.floor(stratAgo / HOUR))} ч назад` : new Date(strat.ts).toLocaleDateString('ru-RU')}
            <span className='text-muted-foreground'> — не ракетный удар, а предупреждение</span>
          </span>
        </div>
      )}
    </div>
  )
}

export function AlertStatsView({ s }: { s: AlertStats }) {
  const [blocks, setBlocks] = useState(loadBlocks)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const toggle = (k: BlockKey) =>
    setBlocks((b) => {
      const next = { ...b, [k]: !b[k] }
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next))
      } catch {
        /* приватный режим — просто не запоминаем */
      }
      return next
    })
  return (
    <div className='space-y-3'>
      <div role='group' aria-label='Показать блоки статистики' className='flex flex-wrap gap-1.5'>
        {BLOCKS.map((b) => (
          <Button key={b.key} size='sm' variant={blocks[b.key] ? 'secondary' : 'outline'} aria-pressed={blocks[b.key]} onClick={() => toggle(b.key)}>
            {blocks[b.key] ? '✓ ' : ''}
            {b.label}
          </Button>
        ))}
      </div>
      <div className='space-y-3'>
        {blocks.chart && (
          <div className='space-y-1'>
            <div className='flex flex-wrap items-center gap-x-4 gap-y-1 text-xs'>
              <span className='inline-flex items-center gap-1.5'>
                <Swatch /> дроны и прочее
              </span>
              <span className='inline-flex items-center gap-1.5'>
                <Swatch hatch /> ракеты (штриховка)
              </span>
            </div>
            <Suspense fallback={<Fallback />}>
              <StatsBars series={s.series} bucket={s.bucket} mode='stack' />
            </Suspense>
          </div>
        )}
        {blocks.missiles && (
          <div className='space-y-1'>
            <div className='flex items-center gap-1.5 text-xs'>
              <Swatch hatch /> только ракеты: {s.totals.missile} сообщ. в {s.totals.missileDays} дн.
            </div>
            <Suspense fallback={<Fallback />}>
              <StatsBars series={s.series} bucket={s.bucket} mode='missile' />
            </Suspense>
          </div>
        )}
        {blocks.pause && <PauseBlock s={s} now={now} />}
      </div>
      <p className='text-xs text-muted-foreground'>
        Статистика по сообщениям канала, прошедшим фильтр (Киев и область + быстрые угрозы). Не гарантия прогноза.
        {` История с ${new Date(s.coverageFrom).toLocaleDateString('ru-RU')}.`}
      </p>
    </div>
  )
}
