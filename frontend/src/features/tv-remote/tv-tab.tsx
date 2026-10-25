import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Info, Loader2, Menu, Power, Undo2, Volume2, VolumeX, X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AxiosError } from 'axios'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { isTvRepeatable, tvKeyStatus, tvPairLabel, tvStatusLabel, TV_ACCESS_HINT, type TvStatus } from '@/lib/tv-pad'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { BasePadKey, Cap } from '@/features/receiver/pad-key'
import { useTvPress, useTvStatus } from './use-tv'

type KProps = { id: string; label: string; k: string; className?: string; children: React.ReactNode; st: TvStatus | undefined; press: (id: string, key: string) => unknown }
function KeyBtn({ id, label, k, className, children, st, press }: KProps) {
  return (
    <BasePadKey id={id} label={label} cmd={k} status={tvKeyStatus(k, st)} custom={false} cmdTitle={k} repeatable={isTvRepeatable(k)} configure={false} onPress={(i, c) => void press(i, c)} onPick={() => {}} className={className}>
      {children}
    </BasePadKey>
  )
}

// Карточка «Телевизор»: статус сети и основные кнопки (фиксированные ключи, без привязок — они в «Пульте ТВ»)
export function TvTab() {
  const q = useTvStatus()
  const st = q.data
  const press = useTvPress(st)
  const qc = useQueryClient()
  const pair = useMutation({
    mutationFn: async () => (await api.post<{ paired: boolean; mode: 'token' | 'open' }>('/tv/pair')).data,
    onSuccess: (d) => {
      toast.success(d.mode === 'open' ? 'Телевизор принимает команды без токена' : 'Телевизор сопряжён')
      void qc.invalidateQueries({ queryKey: ['tv-status'] })
    },
    // сопряжение не удалось — текст с сервера говорит, что сделать на телевизоре
    onError: (e) => toast.error((e instanceof AxiosError ? (e.response?.data as { message?: string } | undefined)?.message : null) ?? 'Не удалось сопрячь', { duration: 12_000 }),
  })
  const conn = tvStatusLabel(st, q.isError)
  const pairing = tvPairLabel(st)
  const big = 'h-14 rounded-xl'
  return (
    <Card className='mx-auto max-w-md'>
      <CardContent className='space-y-5'>
        <div className='flex items-start justify-between gap-3'>
          <div>
            <h2 className='text-sm font-medium'>Samsung 55″</h2>
            <div className='mt-1 flex items-center gap-2 text-sm' role='status'>
              <span className={cn('inline-block size-2 rounded-full', conn.cls)} aria-hidden /> {conn.label}
              {pairing && (
                <>
                  <span className='text-muted-foreground' aria-hidden>
                    ·
                  </span>
                  <span className={pairing.cls}>{pairing.label}</span>
                </>
              )}
              <span className='text-xs text-muted-foreground'>{st?.host ?? '192.168.31.181'}</span>
            </div>
            {st && !st.online && <p className='mt-1 text-xs text-muted-foreground'>Питание включит сцену {st.sceneOn}</p>}
          </div>
          {st?.online && !st.paired && (
            <Button size='sm' variant='outline' disabled={pair.isPending} onClick={() => pair.mutate()}>
              {pair.isPending && <Loader2 className='animate-spin' />} Сопрячь
            </Button>
          )}
        </div>
        {st?.online && !st.paired && (
          <div className='space-y-1 text-xs text-muted-foreground'>
            <p>Без сопряжения телевизор молча игнорирует команды. Нажмите «Сопрячь» и подтвердите окно на экране телевизора (ждём до 30 с).</p>
            <p>Окно не появляется? {TV_ACCESS_HINT}</p>
          </div>
        )}
        <div className='rounded-3xl bg-gradient-to-b from-zinc-900 to-black p-4 text-zinc-100'>
          <div className='flex items-center justify-between'>
            <KeyBtn st={st} press={press} id='power' label='Питание' k='KEY_POWER' className='size-12 rounded-full from-red-500 to-red-800 text-white'>
              <Power className='size-6' aria-hidden />
            </KeyBtn>
            <KeyBtn st={st} press={press} id='source' label='Источник' k='KEY_SOURCE' className='h-10 rounded-full px-5 text-[11px]'>
              SOURCE
            </KeyBtn>
          </div>
          <div className='mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3'>
            <div className='flex flex-col gap-2'>
              <Cap>Громкость</Cap>
              <KeyBtn st={st} press={press} id='vol-up' label='Громче' k='KEY_VOLUP' className={big}>
                <Volume2 className='size-5' aria-hidden /> <span className='ml-1 text-lg'>+</span>
              </KeyBtn>
              <KeyBtn st={st} press={press} id='vol-down' label='Тише' k='KEY_VOLDOWN' className={big}>
                <Volume2 className='size-4' aria-hidden /> <span className='ml-1 text-lg'>−</span>
              </KeyBtn>
            </div>
            <KeyBtn st={st} press={press} id='mute' label='Mute' k='KEY_MUTE' className='size-11 rounded-full'>
              <VolumeX className='size-5' aria-hidden />
            </KeyBtn>
            <div className='flex flex-col gap-2'>
              <Cap>Каналы</Cap>
              <KeyBtn st={st} press={press} id='p-up' label='Канал вверх' k='KEY_CHUP' className={big}>
                <ChevronUp className='size-6' aria-hidden />
              </KeyBtn>
              <KeyBtn st={st} press={press} id='p-down' label='Канал вниз' k='KEY_CHDOWN' className={big}>
                <ChevronDown className='size-6' aria-hidden />
              </KeyBtn>
            </div>
          </div>
          <div className='mt-5 flex justify-center'>
            <div className='grid size-48 grid-cols-3 grid-rows-3 place-items-center rounded-full bg-zinc-950 p-2 shadow-[inset_0_2px_8px_rgba(0,0,0,.8)]'>
              <span />
              <KeyBtn st={st} press={press} id='nav-up' label='Вверх' k='KEY_UP' className='size-12 rounded-full'>
                <ChevronUp className='size-6' aria-hidden />
              </KeyBtn>
              <span />
              <KeyBtn st={st} press={press} id='nav-left' label='Влево' k='KEY_LEFT' className='size-12 rounded-full'>
                <ChevronLeft className='size-6' aria-hidden />
              </KeyBtn>
              <KeyBtn st={st} press={press} id='enter' label='ENTER' k='KEY_ENTER' className='size-14 rounded-full border border-zinc-500 text-[10px]'>
                ENTER
              </KeyBtn>
              <KeyBtn st={st} press={press} id='nav-right' label='Вправо' k='KEY_RIGHT' className='size-12 rounded-full'>
                <ChevronRight className='size-6' aria-hidden />
              </KeyBtn>
              <span />
              <KeyBtn st={st} press={press} id='nav-down' label='Вниз' k='KEY_DOWN' className='size-12 rounded-full'>
                <ChevronDown className='size-6' aria-hidden />
              </KeyBtn>
              <span />
            </div>
          </div>
          <div className='mt-5 grid grid-cols-4 gap-2'>
            <KeyBtn st={st} press={press} id='return' label='Назад' k='KEY_RETURN' className='h-12 flex-col gap-0.5 rounded-md text-[9px]'>
              <Undo2 className='size-4' aria-hidden /> RETURN
            </KeyBtn>
            <KeyBtn st={st} press={press} id='exit' label='Выход' k='KEY_EXIT' className='h-12 flex-col gap-0.5 rounded-md text-[9px]'>
              <X className='size-4' aria-hidden /> EXIT
            </KeyBtn>
            <KeyBtn st={st} press={press} id='info' label='Информация' k='KEY_INFO' className='h-12 flex-col gap-0.5 rounded-md text-[9px]'>
              <Info className='size-4' aria-hidden /> INFO
            </KeyBtn>
            <KeyBtn st={st} press={press} id='menu' label='Меню' k='KEY_MENU' className='h-12 flex-col gap-0.5 rounded-md text-[9px]'>
              <Menu className='size-4' aria-hidden /> MENU
            </KeyBtn>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export type { TvStatus }
