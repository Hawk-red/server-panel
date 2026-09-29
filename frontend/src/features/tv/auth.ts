import { redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { meQuery } from '@/lib/auth'

// Вход в ТВ-режим — та же сессия, что и у панели
export async function tvBeforeLoad({ context, location }: { context: { queryClient: QueryClient }; location: { href: string } }) {
  try {
    await context.queryClient.ensureQueryData(meQuery)
  } catch (error) {
    if (error instanceof AxiosError && error.response?.status === 401) throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    throw error
  }
}
