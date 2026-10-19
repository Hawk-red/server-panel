import { createFileRoute } from '@tanstack/react-router'
import { SmartHome } from '@/features/smarthome'

export const Route = createFileRoute('/_authenticated/smarthome/')({
  component: SmartHome,
})
