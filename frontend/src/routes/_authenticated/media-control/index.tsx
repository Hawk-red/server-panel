import { createFileRoute } from '@tanstack/react-router'
import { MediaHubPage } from '@/features/media-hub'
import { parseMediaTab } from '@/lib/media-tabs'

export const Route = createFileRoute('/_authenticated/media-control/')({
  validateSearch: (s: Record<string, unknown>) => ({ tab: parseMediaTab(s.tab) }),
  component: function MediaControl() {
    const { tab } = Route.useSearch()
    return <MediaHubPage tab={tab} />
  },
})
