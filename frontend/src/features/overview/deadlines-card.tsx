import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { CalendarClock, CircleAlert, CircleCheck, Globe, KeyRound, Pencil, Plus, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Deadline, DeadlineConfig } from '@/features/infra-types'
import { NoData } from '@/components/no-data'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

const KIND_ICON = { cert: ShieldCheck, domain: Globe, token: KeyRound, other: CalendarClock } as const
const KIND_LABEL = { domain: 'Домен', token: 'Токен / ключ', other: 'Другое' } as const

// Уровень срока: ≤ 7 дней — красный, ≤ 30 — жёлтый; всегда со значком и словом
function level(days: number) {
  if (days < 0) return { cls: 'text-danger-foreground', Icon: CircleAlert, word: 'истёк' }
  if (days <= 7) return { cls: 'text-danger-foreground', Icon: CircleAlert, word: 'срочно' }
  if (days <= 30) return { cls: 'text-warn-foreground', Icon: TriangleAlert, word: 'скоро' }
  return { cls: 'text-ok-foreground', Icon: CircleCheck, word: 'в запасе' }
}

function plural(n: number) {
  const a = Math.abs(n) % 100
  const b = a % 10
  return a > 10 && a < 20 ? 'дней' : b === 1 ? 'день' : b >= 2 && b <= 4 ? 'дня' : 'дней'
}

const errMsg = (e: unknown) => (e instanceof AxiosError && e.response?.data?.message) || 'не удалось сохранить'

function EditDialog({ open, onOpenChange, config }: { open: boolean; onOpenChange: (o: boolean) => void; config: DeadlineConfig }) {
  const qc = useQueryClient()
  const [domains, setDomains] = useState('')
  const [manual, setManual] = useState<DeadlineConfig['manual']>([])
  useEffect(() => {
    if (open) {
      setDomains(config.domains.join('\n'))
      setManual(config.manual)
    }
  }, [open, config])
  const save = useMutation({
    mutationFn: () => api.put('/deadlines/config', { domains: domains.split(/[\s,]+/).filter(Boolean), manual }),
    onSuccess: () => {
      toast.success('Сроки сохранены')
      qc.invalidateQueries({ queryKey: ['deadlines'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
      onOpenChange(false)
    },
    onError: (e) => toast.error(errMsg(e)),
  })
  const set = (i: number, patch: Partial<DeadlineConfig['manual'][number]>) => setManual(manual.map((m, j) => (j === i ? { ...m, ...patch } : m)))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Сроки: что отслеживать</DialogTitle>
          <DialogDescription>Сертификат api.pulsdev.net проверяется сам. Даты доменов панель узнаёт у реестра (RDAP). Всё остальное — токены, оплаты, продления — впишите вручную.</DialogDescription>
        </DialogHeader>
        <div className='space-y-4'>
          <div className='space-y-1.5'>
            <label htmlFor='dl-domains' className='text-sm font-medium'>Домены (по одному в строке)</label>
            <Textarea id='dl-domains' rows={3} value={domains} onChange={(e) => setDomains(e.target.value)} className='font-mono text-sm' placeholder='example.com' />
          </div>
          <div className='space-y-2'>
            <div className='text-sm font-medium'>Свои даты</div>
            {manual.length === 0 && <p className='text-xs text-muted-foreground'>Пока пусто. Например: «Токен GitHub — 2026-12-01».</p>}
            {manual.map((m, i) => (
              <div key={m.id || i} className='grid grid-cols-[1fr_auto] gap-2 rounded-md border p-2 sm:grid-cols-[1fr_9rem_8.5rem_auto]'>
                <Input aria-label='Название' placeholder='Название' value={m.title} maxLength={80} onChange={(e) => set(i, { title: e.target.value })} />
                <select
                  aria-label='Тип'
                  value={m.kind}
                  onChange={(e) => set(i, { kind: e.target.value as DeadlineConfig['manual'][number]['kind'] })}
                  className='h-9 rounded-md border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring'
                >
                  {Object.entries(KIND_LABEL).map(([k, l]) => (
                    <option key={k} value={k}>{l}</option>
                  ))}
                </select>
                <Input aria-label='Дата' type='date' value={m.date} onChange={(e) => set(i, { date: e.target.value })} />
                <Button type='button' variant='ghost' size='icon' aria-label='Удалить' onClick={() => setManual(manual.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button type='button' variant='outline' size='sm' onClick={() => setManual([...manual, { id: '', title: '', kind: 'token', date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) }])}>
              <Plus /> Добавить дату
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Сохранить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DeadlinesCard() {
  const [editing, setEditing] = useState(false)
  const { data, isError } = useQuery({
    queryKey: ['deadlines'],
    queryFn: async () => (await api.get<{ items: Deadline[]; config: DeadlineConfig }>('/deadlines')).data,
    refetchInterval: 60_000,
  })
  return (
    <Card id='deadlines' className='gap-2'>
      <CardHeader className='flex flex-row items-center justify-between space-y-0'>
        <CardTitle className='flex items-center gap-2 text-sm font-medium'>
          <CalendarClock className='size-4 text-time' aria-hidden='true' /> Сроки
        </CardTitle>
        <Button variant='ghost' size='sm' onClick={() => setEditing(true)} disabled={!data}>
          <Pencil /> Изменить
        </Button>
      </CardHeader>
      <CardContent>
        {isError ? (
          <NoData reason='бэкенд не ответил' />
        ) : !data ? (
          <span className='text-sm text-muted-foreground'>Загрузка…</span>
        ) : data.items.length === 0 ? (
          <span className='text-sm text-muted-foreground'>Ничего не отслеживается — нажмите «Изменить».</span>
        ) : (
          <ul className='divide-y'>
            {data.items.map((d) => {
              const Icon = KIND_ICON[d.kind]
              const lv = d.daysLeft !== null ? level(d.daysLeft) : null
              return (
                <li key={d.id} className='flex items-center justify-between gap-3 py-2.5'>
                  <div className='flex min-w-0 items-center gap-2.5'>
                    <Icon className='size-4 shrink-0 text-muted-foreground' aria-hidden='true' />
                    <div className='min-w-0'>
                      <div className='truncate text-sm font-medium'>{d.title}</div>
                      <div className='text-xs text-muted-foreground'>
                        {d.expires ? `до ${new Date(d.expires).toLocaleDateString('ru-RU')}` : 'дата неизвестна'}
                        {d.error && d.error !== 'проверяется…' && ` · ${d.error}`}
                        {d.error === 'проверяется…' && ' · проверяется…'}
                        {d.note && !d.error && ` · ${d.note}`}
                      </div>
                    </div>
                  </div>
                  {lv && d.daysLeft !== null ? (
                    <div className={`flex shrink-0 items-center gap-1.5 text-end ${lv.cls}`} title={lv.word}>
                      <lv.Icon className='size-4' aria-hidden='true' />
                      <div className='leading-tight'>
                        <div className='text-lg font-bold tabular-nums'>{Math.abs(d.daysLeft)}</div>
                        <div className='text-[11px]'>{d.daysLeft < 0 ? `${plural(d.daysLeft)} назад` : plural(d.daysLeft)}</div>
                      </div>
                    </div>
                  ) : (
                    <NoData reason={d.error} />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
      {data && <EditDialog open={editing} onOpenChange={setEditing} config={data.config} />}
    </Card>
  )
}
