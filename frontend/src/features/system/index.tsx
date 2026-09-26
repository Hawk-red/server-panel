import { lazy, Suspense } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Page } from '@/components/layout/page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Autostart } from './autostart'
import { Cron } from './cron'
import { Disks } from './disks'
import { Logs } from './logs'
import { Services } from './services'

// Графики (recharts) — отдельным чанком, грузятся только на вкладке «Ресурсы»
const Resources = lazy(() => import('./resources').then((m) => ({ default: m.Resources })))

export const SYSTEM_TABS = ['resources', 'disks', 'cron', 'autostart', 'services', 'logs'] as const
export type SystemTab = (typeof SYSTEM_TABS)[number]

const LABELS: Record<SystemTab, string> = {
  resources: 'Ресурсы',
  disks: 'Диски',
  cron: 'Cron',
  autostart: 'Автозагрузка',
  services: 'Службы',
  logs: 'Логи',
}

export function System({ tab, source }: { tab: SystemTab; source?: string }) {
  const navigate = useNavigate({ from: '/system/' })
  return (
    <Page title='Система' description='CPU, память, температура, диски, расписания, службы и логи'>
      <Tabs value={tab} onValueChange={(v) => navigate({ search: { tab: v as SystemTab } })}>
        <div className='-mx-4 overflow-x-auto px-4 pb-1'>
          <TabsList>
            {SYSTEM_TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {LABELS[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value='resources'>{tab === 'resources' && (
            <Suspense fallback={<p className='text-sm text-muted-foreground'>Загрузка графиков…</p>}>
              <Resources />
            </Suspense>
          )}</TabsContent>
        <TabsContent value='disks'>{tab === 'disks' && <Disks />}</TabsContent>
        <TabsContent value='cron'>{tab === 'cron' && <Cron />}</TabsContent>
        <TabsContent value='autostart'>{tab === 'autostart' && <Autostart />}</TabsContent>
        <TabsContent value='services'>{tab === 'services' && <Services />}</TabsContent>
        <TabsContent value='logs'>{tab === 'logs' && <Logs source={source} />}</TabsContent>
      </Tabs>
    </Page>
  )
}
