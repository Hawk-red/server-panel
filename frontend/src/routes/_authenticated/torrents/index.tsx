import { createFileRoute } from '@tanstack/react-router'
import { SectionStub } from '@/features/section'

export const Route = createFileRoute('/_authenticated/torrents/')({
  component: () => (
    <SectionStub
      title='Торренты'
      description='qBittorrent: закачки, скорость, место на диске'
      stage={3}
    />
  ),
})
