import { ErrorPage } from './error-page'

export function MaintenanceError() {
  return (
    <ErrorPage
      code='503'
      title='Панель на обслуживании'
      text='Бэкенд панели временно недоступен. Попробуйте через минуту.'
    />
  )
}
