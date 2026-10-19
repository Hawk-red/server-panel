import { createFileRoute } from '@tanstack/react-router'
import { ReceiverRemote } from '@/features/media/remote'

export const Route = createFileRoute('/_authenticated/media/remote')({
  component: ReceiverRemote,
})
