import { createFileRoute } from '@tanstack/react-router'
import { SectionStub } from '@/features/section'

export const Route = createFileRoute('/_authenticated/docker/')({
  component: () => (
    <SectionStub
      title='Docker'
      description='Контейнеры, образы, compose-стеки'
      stage={3}
    />
  ),
})
