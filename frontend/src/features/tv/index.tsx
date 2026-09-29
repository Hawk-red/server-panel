import { isTvSection, type TvSectionId } from './sections'
import { TvInternet } from './internet'
import { TvNetwork } from './network'
import { TvOverview } from './overview'
import { TvShell } from './shell'
import { TvSystem } from './system'
import { TvTorrents } from './torrents'

const VIEWS: Record<TvSectionId, () => React.JSX.Element> = {
  overview: TvOverview,
  system: TvSystem,
  internet: TvInternet,
  torrents: TvTorrents,
  network: TvNetwork,
}

// /tv — обзор, /tv/<раздел> — ТВ-версия раздела
export function TvView({ section = 'overview' }: { section?: string }) {
  const id = isTvSection(section) ? section : 'overview'
  const View = VIEWS[id]
  return (
    <TvShell id={id}>
      <View />
    </TvShell>
  )
}
