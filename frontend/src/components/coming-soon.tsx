import { Construction } from 'lucide-react'

export function ComingSoon({ stage }: { stage: number }) {
  return (
    <div className='flex min-h-[50svh] flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center'>
      <Construction size={48} className='text-muted-foreground' />
      <h2 className='text-xl font-semibold'>Раздел в разработке</h2>
      <p className='text-muted-foreground'>Появится на этапе {stage}.</p>
    </div>
  )
}
