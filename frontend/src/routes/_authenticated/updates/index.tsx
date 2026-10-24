import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { UpdatesPage } from '@/features/system/updates'

export const Route = createFileRoute('/_authenticated/updates/')({
  validateSearch: z.object({ focus: z.string().optional() }),
  component: UpdatesPage,
})
