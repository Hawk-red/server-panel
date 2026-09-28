import { createFileRoute } from '@tanstack/react-router'
import { Internet } from '@/features/internet'

export const Route = createFileRoute('/_authenticated/internet/')({
  component: Internet,
})
