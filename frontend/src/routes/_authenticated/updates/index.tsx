import { createFileRoute } from '@tanstack/react-router'
import { UpdatesPage } from '@/features/system/updates'

export const Route = createFileRoute('/_authenticated/updates/')({
  component: UpdatesPage,
})
