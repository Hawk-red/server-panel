import { createFileRoute } from '@tanstack/react-router'
import { HomeAssistantPage } from '@/features/homeassistant'

export const Route = createFileRoute('/_authenticated/homeassistant/')({
  component: HomeAssistantPage,
})
