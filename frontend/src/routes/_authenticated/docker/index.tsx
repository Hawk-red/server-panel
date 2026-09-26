import { createFileRoute } from '@tanstack/react-router'
import { Docker } from '@/features/docker'

export const Route = createFileRoute('/_authenticated/docker/')({
  component: Docker,
})
