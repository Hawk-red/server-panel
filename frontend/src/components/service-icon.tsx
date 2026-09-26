import { Box } from 'lucide-react'
import icons from '@/lib/icons.gen.json'
import { cn } from '@/lib/utils'

const manifest = icons as Record<string, 'svg' | 'png' | null>

// Иконки dashboard-icons хранятся локально в public/icons (npm run fetch-icons)
export function ServiceIcon({ slug, className }: { slug?: string | null; className?: string }) {
  const ext = slug ? manifest[slug] : null
  if (!slug || !ext) return <Box className={cn('size-6 text-muted-foreground', className)} aria-hidden='true' />
  return <img src={`/icons/${slug}.${ext}`} alt='' className={cn('size-6 object-contain', className)} loading='lazy' />
}
