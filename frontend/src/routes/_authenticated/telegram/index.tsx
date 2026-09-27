import { createFileRoute } from '@tanstack/react-router'
import { Telegram } from '@/features/telegram'

export const Route = createFileRoute('/_authenticated/telegram/')({
  component: Telegram,
})
