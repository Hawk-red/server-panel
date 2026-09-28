import { createFileRoute } from '@tanstack/react-router'
import { Backups } from '@/features/backups'

export const Route = createFileRoute('/_authenticated/backups/')({
  component: Backups,
})
