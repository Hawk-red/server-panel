// Ссылки на локальные службы. Строятся ТОЛЬКО из адреса сервера в LAN (config.lanHost) и реестра ниже, никогда из адреса страницы
// (панель открывается и по https://panel.pulsdev.net:9443, где портов служб нет, а HSTS принудительно меняет http на https).
// Схема проверена по факту (curl -sI): все службы на своих портах отвечают по http; у самоподписанных сертификатов нет ничего,
// кроме админки SFTPGo (https, имя api.pulsdev.net). Снаружи (isInternal ложь) адреса не отдаются вовсе.
import { config } from '../config.js'

type Def = { scheme: 'http' | 'https'; port: number; path?: string; host?: string }

export const SERVICE_LINKS: Record<string, Def> = {
  jellyfin: { scheme: 'http', port: 8096, path: '/web/' },
  minimserver: { scheme: 'http', port: 9790 },
  bubbleupnp: { scheme: 'http', port: 58050 },
  portainer: { scheme: 'http', port: 9000 },
  adguard: { scheme: 'http', port: 3000 },
  qbittorrent: { scheme: 'http', port: 8090 },
  mirror: { scheme: 'http', port: 80 }, // зеркало jetsetter (default_server на :80)
  marantz: { scheme: 'http', port: 80, host: config.marantz.host }, // другое устройство в LAN
  sftpgo_admin: { scheme: 'https', port: 8443, host: 'api.pulsdev.net', path: '/files/web/admin/' }, // админка обменника: nginx, только LAN/VPN
}

export type LinkTarget = { origin: string; path: string }

const origin = (d: Def) => `${d.scheme}://${d.host ?? config.lanHost}${(d.scheme === 'http' && d.port === 80) || (d.scheme === 'https' && d.port === 443) ? '' : `:${d.port}`}`

// Внутреннему клиенту — адреса, внешнему — null (ссылки в интерфейсе станут неактивными)
export function linksFor(internal: boolean) {
  const services: Record<string, LinkTarget | null> = {}
  for (const [id, d] of Object.entries(SERVICE_LINKS)) services[id] = internal ? { origin: origin(d), path: d.path ?? '/' } : null
  return { internal, lanHost: internal ? config.lanHost : null, services }
}
