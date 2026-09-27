import { createFileRoute } from '@tanstack/react-router'
import { Access } from '@/features/access'

export const Route = createFileRoute('/_authenticated/access/')({
  component: Access,
})
