import { createFileRoute, redirect } from '@tanstack/react-router'
import { legacyReceiverTab } from '@/lib/media-tabs'

// Старый адрес страницы «Ресивер»: закладки работают, вкладка переносится (?tab=remote → «Пульт ресивера»)
export const Route = createFileRoute('/_authenticated/receiver/')({
  validateSearch: (s: Record<string, unknown>) => ({ tab: typeof s.tab === 'string' ? s.tab : undefined }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/media-control', search: { tab: legacyReceiverTab(search.tab) }, replace: true })
  },
})
