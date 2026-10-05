import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { AxiosError } from 'axios'
import { Loader2, LogIn } from 'lucide-react'
import { toast } from 'sonner'
import { authInfoQuery, login, meQuery } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { PasswordInput } from '@/components/password-input'
import { Input } from '@/components/ui/input'

const formSchema = z.object({
  password: z.string().min(1, 'Введите пароль'),
  code: z.string().max(32).optional(),
})

interface UserAuthFormProps extends React.HTMLAttributes<HTMLFormElement> {
  redirectTo?: string
}

export function UserAuthForm({
  className,
  redirectTo,
  ...props
}: UserAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Снаружи (из интернета) вход — пароль и код из приложения; изнутри — как раньше, только пароль
  const external = useQuery(authInfoQuery).data?.external === true

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: '', code: '' },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    if (external && !data.code?.trim()) {
      form.setError('code', { message: 'Введите код из приложения' })
      return
    }
    setIsLoading(true)
    try {
      await login(data.password, external ? data.code?.trim() : undefined)
      await queryClient.invalidateQueries({ queryKey: meQuery.queryKey })
      // redirect — только внутренние пути панели
      const target = redirectTo?.startsWith('/') ? redirectTo : '/'
      navigate({ to: target, replace: true })
    } catch (error) {
      const status = error instanceof AxiosError ? error.response?.status : 0
      const message =
        error instanceof AxiosError ? error.response?.data?.message : undefined
      if (status === 429) toast.error(message ?? 'Слишком много попыток')
      else if (status === 401) toast.error(message ?? 'Неверный пароль')
      else if (status === 403) toast.error(message ?? 'Вход закрыт')
      else toast.error('Бэкенд панели недоступен')
      form.resetField('password')
      form.resetField('code')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-3', className)}
        {...props}
      >
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Пароль</FormLabel>
              <FormControl>
                <PasswordInput
                  autoFocus
                  autoComplete='current-password'
                  placeholder='••••••••'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {external && (
          <FormField
            control={form.control}
            name='code'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Код из приложения</FormLabel>
                <FormControl>
                  <Input inputMode='text' autoComplete='one-time-code' placeholder='6 цифр или код восстановления' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        <Button className='mt-2 h-11' disabled={isLoading}>
          {isLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
          Войти
        </Button>
      </form>
    </Form>
  )
}
