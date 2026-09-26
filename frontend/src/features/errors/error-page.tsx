import { useNavigate, useRouter } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type ErrorPageProps = {
  code?: string
  title: string
  text: React.ReactNode
  minimal?: boolean
  className?: string
}

export function ErrorPage({
  code,
  title,
  text,
  minimal = false,
  className,
}: ErrorPageProps) {
  const navigate = useNavigate()
  const { history } = useRouter()
  return (
    <div className={cn('h-svh w-full', className)}>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2 px-4'>
        {!minimal && code && (
          <h1 className='text-[7rem] leading-tight font-bold'>{code}</h1>
        )}
        <span className='font-medium'>{title}</span>
        <p className='text-center text-muted-foreground'>{text}</p>
        {!minimal && (
          <div className='mt-6 flex gap-4'>
            <Button variant='outline' onClick={() => history.go(-1)}>
              Назад
            </Button>
            <Button onClick={() => navigate({ to: '/' })}>На главную</Button>
          </div>
        )}
      </div>
    </div>
  )
}
