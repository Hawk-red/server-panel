import { createFileRoute } from '@tanstack/react-router'
import { AiChat } from '@/features/ai'

export const Route = createFileRoute('/_authenticated/ai/')({
  component: AiChat,
})
