import { createFileRoute } from '@tanstack/react-router'
import { SectionStub } from '@/features/section'

export const Route = createFileRoute('/_authenticated/access/')({
  component: () => (
    <SectionStub
      title='SSH и доступ'
      description='Ключи, сессии, fail2ban, RDP/VNC, WireGuard'
      stage={5}
    />
  ),
})
