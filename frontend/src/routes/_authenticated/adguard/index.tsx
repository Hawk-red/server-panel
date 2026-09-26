import { createFileRoute } from '@tanstack/react-router'
import { Adguard } from '@/features/adguard'

export const Route = createFileRoute('/_authenticated/adguard/')({
  component: Adguard,
})
