import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { api } from '@/lib/api'
import type { Autostart as AutostartData } from '@/lib/types'
import { NoData } from '@/components/no-data'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'

const TYPE_LABEL: Record<string, string> = { service: 'служба', timer: 'таймер', socket: 'сокет', path: 'path', mount: 'монтирование' }

export function Autostart() {
  const [q, setQ] = useState('')
  const { data, isError } = useQuery({
    queryKey: ['autostart'],
    queryFn: async () => (await api.get<AutostartData>('/system/autostart')).data,
    refetchInterval: 60_000,
  })
  if (isError) return <NoData reason='не удалось получить список' />
  const filter = (s: string) => s.toLowerCase().includes(q.toLowerCase())
  const units = (data?.units ?? []).filter((u) => filter(u.unit)).sort((a, b) => a.unit.localeCompare(b.unit))
  const main = units.filter((u) => !u.background)
  const background = units.filter((u) => u.background)
  const containers = (data?.containers ?? []).filter((c) => filter(c.name) || filter(c.image))

  return (
    <div className='space-y-4'>
      <Input placeholder='Фильтр по имени…' value={q} onChange={(e) => setQ(e.target.value)} className='max-w-sm' />
      <div className='grid gap-4 lg:grid-cols-2'>
        <Card className='gap-2'>
          <CardHeader>
            <CardTitle className='text-sm font-medium'>systemd: включены в автозагрузку ({main.length})</CardTitle>
          </CardHeader>
          <CardContent className='space-y-1'>
            {main.map((u) => (
              <div key={u.unit} className='flex items-center justify-between gap-2 text-sm'>
                <span className='truncate'>{u.unit}</span>
                <Badge variant='outline'>{TYPE_LABEL[u.type] ?? u.type}</Badge>
              </div>
            ))}
            <Collapsible className='pt-2'>
              <CollapsibleTrigger className='flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground'>
                <ChevronDown className='size-4' /> Системный фон ({background.length})
              </CollapsibleTrigger>
              <CollapsibleContent className='mt-2 space-y-1'>
                {background.map((u) => (
                  <div key={u.unit} className='flex items-center justify-between gap-2 text-sm text-muted-foreground'>
                    <span className='truncate'>{u.unit}</span>
                    <span className='text-xs'>{TYPE_LABEL[u.type] ?? u.type}</span>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
        <Card className='gap-2'>
          <CardHeader>
            <CardTitle className='text-sm font-medium'>Docker: restart policy</CardTitle>
          </CardHeader>
          <CardContent className='space-y-2'>
            {data && data.containers === null ? (
              <NoData reason='нет доступа к Docker' />
            ) : (
              containers
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <div key={c.name} className='flex items-center justify-between gap-2 text-sm'>
                    <div className='min-w-0'>
                      <div className='truncate font-medium'>{c.name}</div>
                      <div className='truncate text-xs text-muted-foreground'>{c.image}</div>
                    </div>
                    <div className='flex shrink-0 items-center gap-3'>
                      <Badge variant={c.restart === 'no' ? 'outline' : 'secondary'}>{c.restart}</Badge>
                      <StatusBadge status={c.state === 'running' ? 'ok' : 'error'} label={c.state === 'running' ? 'работает' : c.state} />
                    </div>
                  </div>
                ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
