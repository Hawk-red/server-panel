import { Server } from 'lucide-react'

type AuthLayoutProps = {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className='container grid h-svh max-w-none items-center justify-center px-4'>
      <div className='mx-auto flex w-full max-w-sm flex-col justify-center space-y-2 py-8 sm:p-8'>
        <div className='mb-4 flex items-center justify-center gap-2'>
          <Server className='size-6' />
          <h1 className='text-xl font-medium'>Mac Mini — панель сервера</h1>
        </div>
        {children}
      </div>
    </div>
  )
}
