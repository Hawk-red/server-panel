import { createFileRoute } from '@tanstack/react-router'
import { tvBeforeLoad } from '@/features/tv/auth'
import { TvView } from '@/features/tv'

// /tv — полноэкранный режим для телевизора, без меню
export const Route = createFileRoute('/tv')({
  beforeLoad: tvBeforeLoad,
  component: () => <TvView />,
})
