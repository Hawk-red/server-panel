import { createFileRoute } from '@tanstack/react-router'
import { SectionStub } from '@/features/section'

export const Route = createFileRoute('/_authenticated/adguard/')({
  component: () => (
    <SectionStub
      title='AdGuard Home'
      description='DNS-фильтр: статистика и управление защитой'
      stage={3}
    />
  ),
})
