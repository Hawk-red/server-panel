import { ErrorPage } from './error-page'

export function NotFoundError() {
  return (
    <ErrorPage
      code='404'
      title='Страница не найдена'
      text='Такого раздела нет или он был перемещён.'
    />
  )
}
