import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { Network } from '@/features/network'

// ?device=MAC — открыть карточку устройства сразу (переход из журнала действий)
const searchSchema = z.object({ device: z.string().optional() })

export const Route = createFileRoute('/_authenticated/network/')({
  validateSearch: searchSchema,
  component: RouteComponent,
})

// eslint-disable-next-line react-refresh/only-export-components
function RouteComponent() {
  const { device } = Route.useSearch()
  return <Network initialDevice={device} />
}
