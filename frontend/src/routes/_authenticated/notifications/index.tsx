import { createFileRoute } from '@tanstack/react-router'
import { Notifications } from '@/features/notify'

export const Route = createFileRoute('/_authenticated/notifications/')({
  component: Notifications,
})
