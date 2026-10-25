import { createFileRoute, redirect } from '@tanstack/react-router'
// Старый адрес пульта: закладки продолжают работать (вкладка «Marantz»)
export const Route = createFileRoute('/_authenticated/media/remote')({
  beforeLoad: () => {
    throw redirect({ to: '/media-control', search: { tab: 'marantz' }, replace: true })
  },
})
