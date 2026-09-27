// Docker только через docker-socket-proxy (127.0.0.1:2375): GET containers/info/images/version,
// логи и POST start/stop/restart. Группы docker у панели нет.
import { config } from '../config.js'
import { run } from '../exec.js'
import { http, httpJson } from '../http.js'

const api = (path: string) => `${config.dockerProxy}${path}`

// Контейнеры, которыми панель не управляет (иначе потеряет доступ к Docker)
export const PROTECTED = new Set(['docker-socket-proxy'])

export const CONTAINER_WARNINGS: Record<string, string> = {
  adguardhome: 'Остановится DNS-фильтр: устройства, у которых DNS = Mac Mini, потеряют разрешение имён.',
  qbittorrent: 'Все закачки и раздачи остановятся.',
  jellyfin: 'Прервутся текущие просмотры и прослушивания.',
  portainer: 'Веб-интерфейс Portainer станет недоступен.',
  minimserver: 'UPnP-сервер музыки пропадёт из сети.',
  bubbleupnpserver: 'BubbleUPnP Server пропадёт из сети.',
}

// Контейнеры с network_mode: host — портов в Docker API нет, берём из инвентаризации
const HOST_NET_PORTS: Record<string, { host: number; proto: string }[]> = {
  jellyfin: [{ host: 8096, proto: 'tcp' }],
  minimserver: [
    { host: 9790, proto: 'tcp' },
    { host: 9791, proto: 'tcp' },
  ],
  bubbleupnpserver: [
    { host: 58050, proto: 'tcp' },
    { host: 58051, proto: 'tcp' },
  ],
}

// Веб-интерфейс сервиса в контейнере: порт и путь (открывается по адресу, с которого открыта панель)
export const CONTAINER_WEB: Record<string, { port: number; path?: string }> = {
  adguardhome: { port: 3000 },
  qbittorrent: { port: 8090 },
  jellyfin: { port: 8096, path: '/web/' },
  minimserver: { port: 9790 },
  bubbleupnpserver: { port: 58050 },
  portainer: { port: 9000 },
}

type RawContainer = {
  Id: string
  Names: string[]
  Image: string
  State: string
  Status: string
  Created: number
  Ports: { IP?: string; PrivatePort: number; PublicPort?: number; Type: string }[]
  Labels: Record<string, string>
  HostConfig?: { NetworkMode?: string }
}

export type Container = {
  id: string
  name: string
  image: string
  state: string
  status: string
  startedAt: number | null
  ports: { host: number | null; container: number; proto: string; ip: string | null }[]
  networkMode: string | null
  restartPolicy: string | null
  composeProject: string | null
  composeDir: string | null
  version: string | null
  cpuPercent: number | null
  memUsage: number | null
  memLimit: number | null
  protected: boolean
  warning?: string
  web: { port: number; path?: string } | null
}

export async function dockerVersion() {
  const v = await httpJson<{ Version: string; ApiVersion: string }>(api('/version'))
  let compose: string | null = null
  try {
    compose = (await run('/usr/bin/docker', ['compose', 'version', '--short'], { timeoutMs: 5000 })).trim()
  } catch {
    compose = null
  }
  return { engine: v.Version, api: v.ApiVersion, compose }
}

type Inspect = {
  State: { StartedAt: string; Running: boolean }
  HostConfig: { RestartPolicy: { Name: string }; NetworkMode: string }
  Config: { Labels: Record<string, string> | null }
}

async function inspect(id: string) {
  return httpJson<Inspect>(api(`/containers/${id}/json`))
}

// Статистика: stream=false даёт precpu_stats → можно посчитать CPU%. Кэш 15 с.
const statsCache = new Map<string, { at: number; cpu: number | null; mem: number | null; limit: number | null }>()

async function stats(id: string) {
  const c = statsCache.get(id)
  if (c && Date.now() - c.at < 15_000) return c
  try {
    const s = await httpJson<any>(api(`/containers/${id}/stats?stream=false`), { timeoutMs: 6000 })
    const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage
    const sysDelta = s.cpu_stats.system_cpu_usage - (s.precpu_stats.system_cpu_usage ?? 0)
    const cpus = s.cpu_stats.online_cpus ?? 1
    const cache = s.memory_stats?.stats?.inactive_file ?? 0
    const r = {
      at: Date.now(),
      cpu: sysDelta > 0 ? Math.round((cpuDelta / sysDelta) * cpus * 1000) / 10 : 0,
      mem: s.memory_stats?.usage != null ? s.memory_stats.usage - cache : null,
      limit: s.memory_stats?.limit ?? null,
    }
    statsCache.set(id, r)
    return r
  } catch {
    return { at: Date.now(), cpu: null, mem: null, limit: null }
  }
}

export async function listContainers(withStats = false): Promise<Container[]> {
  const raw = await httpJson<RawContainer[]>(api('/containers/json?all=1'))
  return Promise.all(
    raw.map(async (c) => {
      const name = c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12)
      const ins = await inspect(c.Id).catch(() => null)
      const st = withStats && c.State === 'running' ? await stats(c.Id) : null
      const labels = c.Labels ?? {}
      return {
        id: c.Id,
        name,
        image: c.Image,
        state: c.State,
        status: c.Status,
        startedAt: ins?.State.Running ? Date.parse(ins.State.StartedAt) : null,
        ports: HOST_NET_PORTS[name]
          ? HOST_NET_PORTS[name].map((p) => ({ host: p.host, container: p.host, proto: p.proto, ip: null }))
          : c.Ports.filter((p) => p.PublicPort && (!p.IP || p.IP === '0.0.0.0' || p.IP === '127.0.0.1'))
              .map((p) => ({ host: p.PublicPort ?? null, container: p.PrivatePort, proto: p.Type, ip: p.IP ?? null }))
              .filter((p, i, a) => a.findIndex((q) => q.host === p.host && q.container === p.container && q.proto === p.proto) === i),
        networkMode: ins?.HostConfig.NetworkMode ?? c.HostConfig?.NetworkMode ?? null,
        restartPolicy: ins?.HostConfig.RestartPolicy.Name || null,
        composeProject: labels['com.docker.compose.project'] ?? null,
        composeDir: labels['com.docker.compose.project.working_dir'] ?? null,
        version: labels['org.opencontainers.image.version'] ?? null,
        cpuPercent: st?.cpu ?? null,
        memUsage: st?.mem ?? null,
        memLimit: st?.limit ?? null,
        protected: PROTECTED.has(name),
        warning: CONTAINER_WARNINGS[name],
        web: CONTAINER_WEB[name] ?? null,
      }
    })
  )
}

export async function getContainer(name: string) {
  return (await listContainers(false)).find((c) => c.name === name) ?? null
}

export async function listImages() {
  const images = await httpJson<{ Id: string; RepoTags: string[] | null; Size: number; Created: number }[]>(api('/images/json'))
  const containers = await httpJson<RawContainer[]>(api('/containers/json?all=1'))
  const used = new Set(containers.map((c) => (c as unknown as { ImageID: string }).ImageID))
  return images.map((i) => ({
    id: i.Id,
    tags: i.RepoTags?.filter((t) => t !== '<none>:<none>') ?? [],
    size: i.Size,
    created: i.Created * 1000,
    used: used.has(i.Id),
  }))
}

export type ContainerAction = 'start' | 'stop' | 'restart'

export async function containerAction(name: string, action: ContainerAction) {
  if (PROTECTED.has(name)) throw Object.assign(new Error('Этим контейнером панель не управляет'), { statusCode: 403 })
  const c = await getContainer(name)
  if (!c) throw Object.assign(new Error('контейнер не найден'), { statusCode: 404 })
  await http(api(`/containers/${c.id}/${action}`), { method: 'POST', timeoutMs: 60_000 })
}

// Логи контейнера: без TTY поток мультиплексирован (8-байтовые заголовки кадров)
export async function containerLogs(name: string, tail: number): Promise<{ ts: number | null; stream: 'stdout' | 'stderr'; text: string }[]> {
  const c = await getContainer(name)
  if (!c) throw Object.assign(new Error('контейнер не найден'), { statusCode: 404 })
  const res = await http(api(`/containers/${c.id}/logs?stdout=1&stderr=1&timestamps=1&tail=${tail}`), { timeoutMs: 15_000 })
  const buf = Buffer.from(await res.arrayBuffer())
  const chunks: { stream: 'stdout' | 'stderr'; data: string }[] = []
  let multiplexed = buf.length >= 8 && (buf[0] === 1 || buf[0] === 2) && buf[1] === 0 && buf[2] === 0 && buf[3] === 0
  if (multiplexed) {
    let off = 0
    while (off + 8 <= buf.length) {
      const type = buf[off]
      const len = buf.readUInt32BE(off + 4)
      if (type > 2 || off + 8 + len > buf.length) {
        multiplexed = false
        break
      }
      chunks.push({ stream: type === 2 ? 'stderr' : 'stdout', data: buf.subarray(off + 8, off + 8 + len).toString('utf8') })
      off += 8 + len
    }
  }
  if (!multiplexed) chunks.splice(0, chunks.length, { stream: 'stdout', data: buf.toString('utf8') })
  const lines: { ts: number | null; stream: 'stdout' | 'stderr'; text: string }[] = []
  for (const ch of chunks) {
    for (const line of ch.data.split('\n')) {
      if (!line) continue
      const m = line.match(/^(\d{4}-\d\d-\d\dT[\d:.]+Z) (.*)$/)
      lines.push({ ts: m ? Date.parse(m[1]) : null, stream: ch.stream, text: m ? m[2] : line })
    }
  }
  return lines
}
