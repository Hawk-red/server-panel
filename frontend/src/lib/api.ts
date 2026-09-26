import axios from 'axios'

// Фронт ходит только в свой бэкенд; сессия — httpOnly cookie
export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 15000,
})
