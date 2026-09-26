import { createFileRoute } from '@tanstack/react-router'
import { SectionStub } from '@/features/section'

export const Route = createFileRoute('/_authenticated/system/')({
  component: () => (
    <SectionStub
      title='Система'
      description='CPU, память, температура, диски, cron, автозагрузка, службы и логи'
      stage={2}
    />
  ),
})
