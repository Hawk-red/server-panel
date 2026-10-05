import { createFileRoute } from '@tanstack/react-router'
import { DisksPage } from '@/features/system/disks'

export const Route = createFileRoute('/_authenticated/disks/')({
  component: DisksPage,
})
