import { ComingSoon } from '@/components/coming-soon'
import { Page } from '@/components/layout/page'

type SectionStubProps = { title: string; description: string; stage: number }

export function SectionStub({ title, description, stage }: SectionStubProps) {
  return (
    <Page title={title} description={description}>
      <ComingSoon stage={stage} />
    </Page>
  )
}
