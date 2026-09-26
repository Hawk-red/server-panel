// Jellyfin (публичная информация + сессии по API-ключу) и ресивер Marantz
import { config } from '../config.js'
import { http, httpJson } from '../http.js'
import { NotConfigured } from './qbittorrent.js'

export async function jellyfinInfo() {
  const i = await httpJson<{ Version: string; ServerName: string }>(`${config.jellyfin.url}/System/Info/Public`, { timeoutMs: 4000 })
  return { version: i.Version, name: i.ServerName }
}

type Session = {
  UserName?: string
  Client: string
  DeviceName: string
  LastActivityDate: string
  NowPlayingItem?: { Name: string; Type: string; SeriesName?: string; Album?: string; AlbumArtist?: string; RunTimeTicks?: number }
  PlayState?: { PositionTicks?: number; IsPaused?: boolean }
}

export async function jellyfinSessions() {
  if (!config.jellyfin.apiKey) throw new NotConfigured('не задан JELLYFIN_API_KEY')
  const sessions = await httpJson<Session[]>(`${config.jellyfin.url}/Sessions?activeWithinSeconds=900`, {
    headers: { 'X-Emby-Token': config.jellyfin.apiKey },
  })
  return sessions.map((s) => ({
    user: s.UserName ?? '—',
    client: s.Client,
    device: s.DeviceName,
    lastActivity: Date.parse(s.LastActivityDate),
    playing: s.NowPlayingItem
      ? {
          title: [s.NowPlayingItem.SeriesName, s.NowPlayingItem.AlbumArtist, s.NowPlayingItem.Name].filter(Boolean).join(' — '),
          type: s.NowPlayingItem.Type,
          paused: Boolean(s.PlayState?.IsPaused),
          progress:
            s.NowPlayingItem.RunTimeTicks && s.PlayState?.PositionTicks
              ? Math.round((s.PlayState.PositionTicks / s.NowPlayingItem.RunTimeTicks) * 100)
              : null,
        }
      : null,
  }))
}

// Marantz NR1604: веб-интерфейс на :8080, состояние питания — XML на :80
export async function marantz() {
  const { host, webPort } = config.marantz
  const online = await http(`http://${host}:${webPort}/`, { timeoutMs: 3000 })
    .then(() => true)
    .catch(() => false)
  let power: string | null = null
  let source: string | null = null
  if (online) {
    try {
      const xml = await (await http(`http://${host}/goform/formMainZone_MainZoneXml.xml`, { timeoutMs: 3000 })).text()
      power = xml.match(/<ZonePower><value>([^<]*)<\/value>/)?.[1]?.trim() ?? null
      source = xml.match(/<InputFuncSelect><value>([^<]*)<\/value>/)?.[1]?.trim() ?? null
    } catch {
      /* питание неизвестно — не ошибка */
    }
  }
  return { host, webPort, online, power, source }
}
