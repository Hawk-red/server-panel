import { createFileRoute } from '@tanstack/react-router'
import { SectionStub } from '@/features/section'

export const Route = createFileRoute('/_authenticated/audit/')({
  component: () => (
    <SectionStub
      title='Журнал действий'
      description='Кто, когда, откуда и что делал в панели'
      stage={7}
    />
  ),
})
