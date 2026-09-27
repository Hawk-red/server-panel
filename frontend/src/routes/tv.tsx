import { createFileRoute, redirect } from '@tanstack/react-router'
import { AxiosError } from 'axios'
import { meQuery } from '@/lib/auth'
import { TvMode } from '@/features/tv'

// /tv — полноэкранный режим для телевизора, без меню; вход — та же сессия, что и у панели
export const Route = createFileRoute('/tv')({
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(meQuery)
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 401) throw redirect({ to: '/sign-in', search: { redirect: location.href } })
      throw error
    }
  },
  component: TvMode,
})
