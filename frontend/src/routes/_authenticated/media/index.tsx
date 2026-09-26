import { createFileRoute } from '@tanstack/react-router'
import { SectionStub } from '@/features/section'

export const Route = createFileRoute('/_authenticated/media/')({
  component: () => (
    <SectionStub
      title='Медиа'
      description='Jellyfin, MinimServer, BubbleUPnP, ресивер Marantz'
      stage={3}
    />
  ),
})
