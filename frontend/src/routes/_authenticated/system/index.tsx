import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { System, SYSTEM_TABS } from '@/features/system'

const searchSchema = z.object({
  tab: z.enum(SYSTEM_TABS).optional().catch(undefined),
  source: z.string().optional(),
})

export const Route = createFileRoute('/_authenticated/system/')({
  validateSearch: searchSchema,
  component: RouteComponent,
})

// eslint-disable-next-line react-refresh/only-export-components
function RouteComponent() {
  const { tab, source } = Route.useSearch()
  return <System tab={tab ?? 'resources'} source={source} />
}
