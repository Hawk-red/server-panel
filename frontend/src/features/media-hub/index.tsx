import { useNavigate } from '@tanstack/react-router'
import { Page } from '@/components/layout/page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MarantzTab } from '@/features/receiver/marantz-tab'
import { SamsungTab } from '@/features/tv-remote/samsung-tab'
import { UniversalTab } from '@/features/universal'
import { MEDIA_TABS, MEDIA_TAB_TITLES, parseMediaTab, type MediaTab } from '@/lib/media-tabs'

/** Страница «Пульт»: универсальный пульт и оригинальные пульты телевизора и ресивера; активная вкладка — в адресе (?tab=) */
export function MediaHubPage({ tab: raw }: { tab?: string }) {
  const tab = parseMediaTab(raw)
  const navigate = useNavigate()
  const setTab = (t: string) => void navigate({ to: '/media-control', search: { tab: t as MediaTab }, replace: true })
  return (
    <Page title='ПУЛЬТ'>
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
        <TabsContent value='universal'>
          <UniversalTab />
        </TabsContent>
        <TabsContent value='samsung'>
          <SamsungTab />
        </TabsContent>
        <TabsContent value='marantz'>
          <MarantzTab />
        </TabsContent>
      </Tabs>
    </Page>
  )
}
