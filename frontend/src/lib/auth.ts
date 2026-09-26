import { queryOptions } from '@tanstack/react-query'
import { api } from './api'

export type Me = {
  user: string
  ip: string
  network: 'lan' | 'vpn' | 'local'
  expiresAt: string
}

export const meQuery = queryOptions({
  queryKey: ['auth', 'me'],
  queryFn: async () => (await api.get<Me>('/auth/me')).data,
  staleTime: 60 * 1000,
  retry: false,
})

export async function login(password: string) {
  await api.post('/auth/login', { password })
}

export async function logout() {
  await api.post('/auth/logout', {})
}
