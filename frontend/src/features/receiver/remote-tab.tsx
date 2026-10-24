import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { bumpVolume, type CmdResult, type ReceiverFullState } from '@/lib/receiver-remote'
import { commandTitle, filterCommands, isRepeatable, type RemoteConfig } from '@/lib/receiver-pad'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { RemotePad } from './remote-pad'

type Send = (command: string, opts?: { quiet?: boolean }) => Promise<CmdResult | null>
type Patch = (fn: (s: ReceiverFullState) => ReceiverFullState) => unknown

/** Окно выбора команды для кнопки: поиск по названию, «без команды», «по умолчанию» */
export function CommandPicker({ button, cfg, onClose, onChoose }: { button: string | null; cfg: RemoteConfig; onClose: () => void; onChoose: (value: string | null) => void }) {
  const [q, setQ] = useState('')
  const cur = button ? (cfg.bindings[button] ?? null) : null
  const def = button ? (cfg.defaults[button] ?? null) : null
  const list = filterCommands(cfg.commands, q)
  const groups = [...new Set(list.map((c) => c.group))]
  return (
    <Dialog open={button !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[85vh] gap-3 overflow-hidden sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Команда для кнопки</DialogTitle>
          <DialogDescription>
            Сейчас: {commandTitle(cfg, cur)}. По умолчанию: {commandTitle(cfg, def)}.
          </DialogDescription>
        </DialogHeader>
        <Input autoFocus placeholder='Поиск по названию' value={q} onChange={(e) => setQ(e.target.value)} aria-label='Поиск команды' />
        <div className='flex gap-2'>
          <Button variant='outline' size='sm' onClick={() => onChoose(null)} disabled={cur === null}>
            Без команды
          </Button>
          <Button variant='outline' size='sm' onClick={() => onChoose('default')} disabled={cur === def}>
            По умолчанию
          </Button>
        </div>
        <div className='-mr-2 min-h-0 flex-1 space-y-3 overflow-y-auto pr-2'>
          {list.length === 0 && <p className='text-sm text-muted-foreground'>Ничего не найдено.</p>}
          {groups.map((g) => (
            <div key={g}>
              <div className='mb-1 text-xs font-medium text-muted-foreground'>{g}</div>
              <div className='flex flex-col gap-1'>
                {list
                  .filter((c) => c.group === g)
                  .map((c) => (
                    <Button key={c.command} variant={c.command === cur ? 'default' : 'ghost'} size='sm' className={cn('h-auto justify-start whitespace-normal py-1.5 text-left', c.command === def && c.command !== cur && 'ring-1 ring-border')} onClick={() => onChoose(c.command)}>
                      <span className='flex-1'>{c.title}</span>
                      <span className='font-mono text-[10px] opacity-60'>{c.command}</span>
                    </Button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

const errText = (e: unknown) => ((e instanceof AxiosError ? (e.response?.data as { message?: string } | undefined)?.message : null) ?? 'Не удалось сохранить')

export function RemoteTab({ st, send, patch }: { st: ReceiverFullState | undefined; send: Send; patch: Patch }) {
  const qc = useQueryClient()
  const [configure, setConfigure] = useState(false)
  const [picking, setPicking] = useState<string | null>(null)
  const q = useQuery({ queryKey: ['receiver-remote'], queryFn: async () => (await api.get<RemoteConfig>('/receiver/remote')).data, staleTime: 60_000 })
  const save = useMutation({
    mutationFn: async (v: { button: string; command: string | null }) => (await api.put<Pick<RemoteConfig, 'defaults' | 'bindings'>>(`/receiver/remote/${v.button}`, { command: v.command })).data,
    onSuccess: (d) => qc.setQueryData<RemoteConfig>(['receiver-remote'], (old) => (old ? { ...old, ...d } : old)),
    onError: (e) => toast.error(errText(e)),
  })
  const cfg = q.data

  const press = (_id: string, cmd: string) => {
    if (cmd === 'MVUP' || cmd === 'MVDOWN') patch((s) => bumpVolume(s, cmd))
    void send(cmd, { quiet: isRepeatable(cmd) || /^(MN|TPAN)/.test(cmd) })
  }

  return (
    <div className='space-y-4'>
      <div className='mx-auto flex w-full max-w-[420px] items-center justify-between gap-3'>
        <p className='text-xs text-muted-foreground'>{configure ? 'Нажмите кнопку, чтобы выбрать для неё команду' : q.isError ? 'Не удалось загрузить привязки кнопок' : ' '}</p>
        <div className='flex shrink-0 items-center gap-2'>
          <Label htmlFor='remote-configure' className='text-sm'>
            Настроить пульт
          </Label>
          <Switch id='remote-configure' checked={configure} onCheckedChange={setConfigure} disabled={!cfg} />
        </div>
      </div>
      <RemotePad st={st} cfg={cfg} configure={configure} onPress={press} onPick={setPicking} />
      {cfg && (
        <CommandPicker
          button={picking}
          cfg={cfg}
          onClose={() => setPicking(null)}
          onChoose={(v) => {
            const button = picking
            setPicking(null)
            if (button) save.mutate({ button, command: v })
          }}
        />
      )}
    </div>
  )
}
