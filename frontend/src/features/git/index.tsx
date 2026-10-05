import { Page } from '@/components/layout/page'
import { PanelChanges } from './history'

// Раздел «Git»: история правок панели и откат/возврат коммитов (git revert, без переписывания истории)
export function Git() {
  return (
    <Page title='Git' description='История правок панели: откат и возврат коммитов через git revert. История не переписывается, автопуш отправляет изменения на GitHub раз в час'>
      <PanelChanges />
    </Page>
  )
}
