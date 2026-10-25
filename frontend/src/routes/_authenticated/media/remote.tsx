import { createFileRoute, redirect } from '@tanstack/react-router'
// Старый адрес пульта: закладки продолжают работать
export const Route = createFileRoute('/_authenticated/media/remote')({
  beforeLoad: () => {
    throw redirect({ to: '/media-control', search: { tab: 'receiver-remote' }, replace: true })
  },
})
