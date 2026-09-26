import { ErrorPage } from './error-page'

export function UnauthorisedError() {
  return (
    <ErrorPage
      code='401'
      title='Нужно войти'
      text='Сессия истекла или вы ещё не вошли в панель.'
    />
  )
}
