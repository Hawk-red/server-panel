import { queryOptions } from '@tanstack/react-query'
import { api } from './api'

export type Me = {
  user: string
  ip: string
  network: 'lan' | 'vpn' | 'local'
  /** запрос пришёл снаружи (из интернета) */
  external?: boolean
  expiresAt: string
}

export const meQuery = queryOptions({
  queryKey: ['auth', 'me'],
  queryFn: async () => (await api.get<Me>('/auth/me')).data,
  staleTime: 60 * 1000,
  retry: false,
})

// code — код из приложения-аутентификатора или одноразовый код восстановления (нужен только при входе снаружи)
export async function login(password: string, code?: string) {
  await api.post('/auth/login', code ? { password, code } : { password })
}

// Откуда пришёл запрос: снаружи форма входа просит ещё и код
export const authInfoQuery = queryOptions({
  queryKey: ['auth', 'info'],
  queryFn: async () => (await api.get<{ external: boolean }>('/auth/info')).data,
  staleTime: 5 * 60 * 1000,
  retry: false,
})

export async function logout() {
  await api.post('/auth/logout', {})
}
