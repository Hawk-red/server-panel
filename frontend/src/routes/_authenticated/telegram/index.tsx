import { createFileRoute } from '@tanstack/react-router'
import { SectionStub } from '@/features/section'

export const Route = createFileRoute('/_authenticated/telegram/')({
  component: () => (
    <SectionStub
      title='Telegram-бот'
      description='Air Alert Monitor: статус, логи, управление'
      stage={4}
    />
  ),
})
