import { createFileRoute } from '@tanstack/react-router'
import { SectionStub } from '@/features/section'

export const Route = createFileRoute('/_authenticated/sites/')({
  component: () => (
    <SectionStub
      title='Сайты и API'
      description='Зеркало jetsetter, api.pulsdev.net, File Browser'
      stage={4}
    />
  ),
})
