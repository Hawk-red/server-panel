import { createFileRoute } from '@tanstack/react-router'
import { Wireless } from '@/features/wireless'

export const Route = createFileRoute('/_authenticated/wireless/')({
  component: Wireless,
})
