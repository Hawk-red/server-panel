import { createFileRoute } from '@tanstack/react-router'
import { Torrents } from '@/features/torrents'

export const Route = createFileRoute('/_authenticated/torrents/')({
  component: Torrents,
})
