import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Pause, Play, Server, X } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { api } from '@/lib/api'
import type { MetricsResponse, Range } from '@/lib/types'
import { cn } from '@/lib/utils'
import { TV_SECTIONS, type TvSectionId } from './sections'

// Режим «ТВ» (/tv, /tv/<раздел>): полноэкранный просмотр с дивана — без меню, крупно, с автообновлением.
// Масштаб: базовый шрифт привязан к ширине экрана (1920 px ≈ 22 px, 3840 px ≈ 44 px), всё в rem —
// раскладка на 1080p и 4K одинаковая, на 4K просто вдвое чётче.
function useTvScale() {
  useEffect(() => {
    const root = document.documentElement
    const prev = root.style.fontSize
    root.style.fontSize = 'clamp(16px, 1.15vw, 48px)'
    return () => {
      root.style.fontSize = prev
    }
  }, [])
}

export const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(t)
  }, [])
  return (
    <span className='text-time tabular-nums'>
      {now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · {now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
    </span>
  )
}

export function Tile({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border bg-card p-5', className)}>
      <div className='mb-2 text-base text-muted-foreground'>{title}</div>
      {children}
    </div>
  )
}

// График для ТВ: крупные подписи (в rem), без подсказок и легенды
export function TvChart({ title, series, range, format, domain, className, heightRem = 10 }: {
  title: string
  series: { name: string; color: string }[]
  range: Range
  format: (v: number) => string
  domain?: [number | 'auto', number | 'auto']
  className?: string
  heightRem?: number
}) {
  const names = series.map((s) => s.name).join(',')
  const { data } = useQuery({
    queryKey: ['metrics', range, names],
    queryFn: async () => (await api.get<MetricsResponse>('/metrics', { params: { range, series: names } })).data,
    refetchInterval: 60_000,
  })
  const rows = new Map<number, Record<string, number>>()
  for (const s of series) for (const [t, v] of data?.series[s.name] ?? []) rows.set(t, { ...(rows.get(t) ?? { t }), [s.name]: v })
  const points = [...rows.values()].sort((a, b) => a.t - b.t)
  const px = remPx()
  const tick = (t: number) => {
    const d = new Date(t)
    return range === 'hour' || range === 'day' ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  }
  return (
    <Tile title={title} className={className}>
      <div style={{ height: `${heightRem}rem` }}>
        {points.length === 0 ? (
          <div className='flex h-full items-center justify-center text-lg text-muted-foreground'>нет данных за этот период</div>
        ) : (
          <ResponsiveContainer width='100%' height='100%'>
            <LineChart data={points} margin={{ top: 6, right: 12, bottom: px * 0.6, left: 0 }}>
              <CartesianGrid strokeDasharray='3 3' className='stroke-muted' />
              <XAxis dataKey='t' type='number' padding={{ left: px * 1.5, right: px }} domain={['dataMin', 'dataMax']} tickFormatter={tick} fontSize={px * 0.8} minTickGap={px * 4} stroke='currentColor' className='text-muted-foreground' />
              <YAxis tickFormatter={format} fontSize={px * 0.8} width={px * 4.5} domain={domain ?? ['auto', 'auto']} stroke='currentColor' className='text-muted-foreground' />
              {series.map((s) => (
                <Line key={s.name} dataKey={s.name} stroke={s.color} dot={false} strokeWidth={px / 7} isAnimationActive={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Tile>
  )
}

const ROTATE_SEC = 20
const readAuto = () => {
  try {
    return localStorage.getItem('tv.autoplay') !== '0'
  } catch {
    return true
  }
}

export function TvShell({ id, children }: { id: TvSectionId; children: React.ReactNode }) {
  useTvScale()
  const navigate = useNavigate()
  const [auto, setAuto] = useState(readAuto)
  const idx = Math.max(0, TV_SECTIONS.findIndex((s) => s.id === id))
  const current = TV_SECTIONS[idx]

  const go = useCallback(
    (to: number) => {
      const s = TV_SECTIONS[(to + TV_SECTIONS.length) % TV_SECTIONS.length]
      void navigate({ to: s.id === 'overview' ? '/tv' : '/tv/$section', params: { section: s.id } as never })
    },
    [navigate]
  )
  const toggleAuto = useCallback(() => {
    setAuto((a) => {
      try {
        localStorage.setItem('tv.autoplay', a ? '0' : '1')
      } catch {
        /* без хранилища просто не запоминаем */
      }
      return !a
    })
  }, [])

  // Автоперелистывание: таймер начинается заново при каждой смене раздела (в том числе пультом)
  useEffect(() => {
    if (!auto) return
    const t = setTimeout(() => go(idx + 1), ROTATE_SEC * 1000)
    return () => clearTimeout(t)
  }, [auto, idx, go])

  // Пульт: ← → — разделы, OK/пробел/P — пауза слайд-шоу, Back/Esc — в панель
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(idx + 1)
      else if (e.key === 'ArrowLeft') go(idx - 1)
      else if (e.key === 'p' || e.key === 'P' || e.key === 'MediaPlayPause' || (e.key === ' ' && document.activeElement === document.body)) toggleAuto()
      else if (e.key === 'Escape' || e.key === 'BrowserBack') void navigate({ to: '/' })
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, idx, navigate, toggleAuto])

  const Icon = current.icon
  const btn = 'inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-base text-muted-foreground hover:bg-muted focus-visible:bg-muted'
  return (
    <div className='relative min-h-svh bg-background p-6 text-foreground'>
      {auto && (
        // key — анимация запускается заново при каждом разделе
        <div key={id} className='absolute inset-x-0 top-0 h-1 overflow-hidden' aria-hidden>
          <div className='h-full origin-left bg-brand/70' style={{ animation: `tv-progress ${ROTATE_SEC}s linear forwards` }} />
        </div>
      )}
      <style>{'@keyframes tv-progress{from{transform:scaleX(0)}to{transform:scaleX(1)}}'}</style>
      <header className='mb-5 flex items-center justify-between gap-4'>
        <div className='flex items-center gap-3 text-3xl font-bold'>
          <Server className='size-9 text-brand' /> Mac Mini
          <span className='text-muted-foreground'>/</span>
          <Icon className={cn('size-8', current.color)} aria-hidden /> {current.title}
        </div>
        <div className='text-xl'>
          <Clock />
        </div>
        <div className='flex items-center gap-2'>
          <button type='button' className={btn} onClick={() => go(idx - 1)} aria-label='Предыдущий раздел'>
            <ChevronLeft className='size-5' />
          </button>
          <button type='button' className={btn} onClick={() => go(idx + 1)} aria-label='Следующий раздел'>
            <ChevronRight className='size-5' />
          </button>
          <button type='button' className={btn} onClick={toggleAuto} aria-pressed={auto}>
            {auto ? <Pause className='size-5' /> : <Play className='size-5' />} {auto ? `Авто ${ROTATE_SEC} с` : 'Авто выключено'}
          </button>
          <Link to='/' className={btn}>
            <X className='size-5' /> Панель
          </Link>
        </div>
      </header>

      {children}

      <nav className='mt-5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground' aria-label='Разделы ТВ-режима'>
        {TV_SECTIONS.map((s, i) => (
          <button key={s.id} type='button' onClick={() => go(i)} className={cn('rounded-full border px-3 py-1', s.id === id ? 'border-brand bg-brand/10 text-foreground' : 'hover:bg-muted')} aria-current={s.id === id}>
            {s.title}
          </button>
        ))}
        <span className='ms-auto'>← → разделы · OK / P — слайд-шоу · Esc — в панель · обновляется каждые 10 с</span>
      </nav>
    </div>
  )
}
