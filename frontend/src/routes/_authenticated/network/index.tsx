import { createFileRoute } from '@tanstack/react-router'
import { SectionStub } from '@/features/section'

export const Route = createFileRoute('/_authenticated/network/')({
  component: () => (
    <SectionStub
      title='Сеть и устройства'
      description='Сканер локальной сети 192.168.31.0/24'
      stage={6}
    />
  ),
})
