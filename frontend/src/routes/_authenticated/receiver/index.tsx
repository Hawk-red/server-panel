import { createFileRoute } from '@tanstack/react-router'
import { ReceiverPage } from '@/features/receiver'

export const Route = createFileRoute('/_authenticated/receiver/')({
  component: ReceiverPage,
})
