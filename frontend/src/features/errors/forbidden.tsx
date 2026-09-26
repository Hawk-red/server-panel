import { ErrorPage } from './error-page'

export function ForbiddenError() {
  return (
    <ErrorPage
      code='403'
      title='Доступ запрещён'
      text='Панель доступна только из домашней сети и через WireGuard.'
    />
  )
}
