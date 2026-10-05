import { createFileRoute } from '@tanstack/react-router'
import { Git } from '@/features/git'

export const Route = createFileRoute('/_authenticated/git/')({
  component: Git,
})
