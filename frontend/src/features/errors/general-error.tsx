import { ErrorPage } from './error-page'

type GeneralErrorProps = React.HTMLAttributes<HTMLDivElement> & {
  minimal?: boolean
}

export function GeneralError({ className, minimal = false }: GeneralErrorProps) {
  return (
    <ErrorPage
      code='500'
      title='Что-то пошло не так'
      text='Ошибка на стороне панели. Попробуйте ещё раз чуть позже.'
      minimal={minimal}
      className={className}
    />
  )
}
