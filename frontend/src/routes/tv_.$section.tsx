import { createFileRoute } from '@tanstack/react-router'
import { tvBeforeLoad } from '@/features/tv/auth'
import { TvView } from '@/features/tv'

// /tv/<раздел> — ТВ-версия раздела (tv_ — не вложен в /tv, у того нет Outlet)
export const Route = createFileRoute('/tv_/$section')({
  beforeLoad: tvBeforeLoad,
  component: function TvSection() {
    const { section } = Route.useParams()
    return <TvView section={section} />
  },
})
