import { useNavigate } from '@tanstack/react-router'
import { Page } from '@/components/layout/page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ReceiverSection } from '@/features/receiver'
import { TvRemoteTab } from '@/features/tv-remote/tv-remote-tab'
import { TvTab } from '@/features/tv-remote/tv-tab'
import { RECEIVER_LAYOUT_PAGE } from '@/lib/receiver-layout'
import { MEDIA_TABS, MEDIA_TAB_TITLES, parseMediaTab, type MediaTab } from '@/lib/media-tabs'

/** Страница «Медиа»: ресивер, телевизор и их экранные пульты; активная вкладка — в адресе (?tab=) */
export function MediaHubPage({ tab: raw }: { tab?: string }) {
  const tab = parseMediaTab(raw)
  const navigate = useNavigate()
  const setTab = (t: string) => void navigate({ to: '/media-control', search: { tab: t as MediaTab }, replace: true })
  return (
    // «Изменить порядок» относится только к блокам вкладки «Ресивер»
    <Page title='Медиа' description='Ресивер Marantz, телевизор Samsung и экранные пульты' layoutPage={tab === 'receiver' ? RECEIVER_LAYOUT_PAGE : undefined}>
      <Tabs value={tab} onValueChange={setTab} className='gap-4'>
        <div className='-mx-1 overflow-x-auto px-1'>
          <TabsList>
            {MEDIA_TABS.map((t) => (
              <TabsTrigger key={t} value={t} className='shrink-0'>
                {MEDIA_TAB_TITLES[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value='receiver'>
          <ReceiverSection view='control' />
        </TabsContent>
        <TabsContent value='tv'>
          <TvTab />
        </TabsContent>
        <TabsContent value='receiver-remote'>
          <ReceiverSection view='remote' />
        </TabsContent>
        <TabsContent value='tv-remote'>
          <TvRemoteTab />
        </TabsContent>
      </Tabs>
    </Page>
  )
}
