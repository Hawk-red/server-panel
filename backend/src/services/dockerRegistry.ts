// Метаданные Docker-образов для раздела «Обновления» — только чтение, без pull.
//
// Локально: GET /images/{id}/json через docker-socket-proxy (метки Config.Labels, дата сборки, digest).
// Удалённо: HEAD /v2/<repo>/manifests/<tag> даёт digest (индекса мультиплатформенного образа — это ТО ЖЕ значение,
// что Docker пишет в RepoDigests после pull). Версию и дату сборки новой версии берём из config blob платформы
// (цепочка: индекс → манифест linux/<arch> → config blob → Labels); эти запросы делаем только когда digest
// изменился и для него ещё нет записи в кэше (метки образа по digest не меняются никогда).
//
// Реестры: Docker Hub и ghcr.io (lscr.io — это алиас ghcr.io для образов linuxserver.io).
// Лимиты: HEAD манифеста на Docker Hub в счёт лимита pull не идёт, а GET (манифест + config blob) — идёт,
// поэтому GET бывают только при смене digest. На 429 включаем паузу для реестра до Retry-After (или 30 минут).
import { http, httpJson, HttpError } from '../http.js'
import { getSetting, setSetting } from '../settings.js'

export type RegistryId = 'hub' | 'ghcr'

const REGISTRIES: Record<RegistryId, { name: string; base: string; token: (repo: string) => string }> = {
  hub: {
    name: 'Docker Hub',
    base: 'https://registry-1.docker.io',
    token: (repo) => `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`,
  },
  ghcr: {
    name: 'ghcr.io',
    base: 'https://ghcr.io',
    token: (repo) => `https://ghcr.io/token?scope=repository:${repo}:pull`,
  },
}

const MANIFEST_ACCEPT = [
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
].join(', ')

export class RateLimited extends Error {
  constructor(
    public registry: RegistryId,
    public until: number
  ) {
    super(`лимит запросов ${REGISTRIES[registry].name}, повтор после ${new Date(until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`)
  }
}

const BACKOFF_KEY = 'updates.docker.backoff'
const DEFAULT_BACKOFF_MS = 30 * 60_000

function backoffUntil(reg: RegistryId): number {
  return getSetting<Record<string, number>>(BACKOFF_KEY, {})[reg] ?? 0
}
function setBackoff(reg: RegistryId, until: number) {
  const m = getSetting<Record<string, number>>(BACKOFF_KEY, {})
  m[reg] = until
  setSetting(BACKOFF_KEY, m)
}

// Токен действует ~5 минут: держим в памяти на 4 минуты
const tokens = new Map<string, { token: string; exp: number }>()
async function tokenFor(reg: RegistryId, repo: string): Promise<string> {
  const key = `${reg}/${repo}`
  const c = tokens.get(key)
  if (c && c.exp > Date.now()) return c.token
  const r = await regFetchJson<{ token?: string; access_token?: string }>(reg, REGISTRIES[reg].token(repo), {})
  const token = r.token ?? r.access_token
  if (!token) throw new Error('реестр не выдал токен')
  tokens.set(key, { token, exp: Date.now() + 4 * 60_000 })
  return token
}

// Обёртка над http(): 429 → пауза для реестра; пока пауза не кончилась, запросов к реестру нет вообще
async function regFetch(reg: RegistryId, url: string, init: RequestInit & { timeoutMs?: number }) {
  const until = backoffUntil(reg)
  if (until > Date.now()) throw new RateLimited(reg, until)
  try {
    return await http(url, { timeoutMs: 12_000, ...init })
  } catch (e) {
    if (e instanceof HttpError && e.status === 429) {
      const next = Date.now() + DEFAULT_BACKOFF_MS
      setBackoff(reg, next)
      throw new RateLimited(reg, next)
    }
    throw e
  }
}
async function regFetchJson<T>(reg: RegistryId, url: string, init: RequestInit & { timeoutMs?: number }): Promise<T> {
  return (await regFetch(reg, url, init)).json() as Promise<T>
}

async function authed(reg: RegistryId, repo: string, path: string, method: 'GET' | 'HEAD') {
  const token = await tokenFor(reg, repo)
  return regFetch(reg, `${REGISTRIES[reg].base}/v2/${repo}/${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: MANIFEST_ACCEPT } })
}

export async function remoteDigest(reg: RegistryId, repo: string, tag: string): Promise<string> {
  const res = await authed(reg, repo, `manifests/${tag}`, 'HEAD')
  const digest = res.headers.get('docker-content-digest')
  if (!digest) throw new Error('реестр не вернул digest')
  return digest
}

export type ImageMeta = { version: string | null; created: number | null }

type Manifest = {
  mediaType?: string
  config?: { digest: string }
  manifests?: { digest: string; platform?: { os?: string; architecture?: string; variant?: string } }[]
}
type ConfigBlob = { created?: string; config?: { Labels?: Record<string, string> | null } }

export const versionOf = (labels: Record<string, string> | null | undefined): string | null => labels?.['org.opencontainers.image.version']?.trim() || null

// Метки и дата сборки образа по digest (платформа linux/<arch>) — без pull, только манифесты и config blob
export async function remoteMeta(reg: RegistryId, repo: string, digest: string, arch: string): Promise<ImageMeta> {
  let m = await (await authed(reg, repo, `manifests/${digest}`, 'GET')).json() as Manifest
  if (m.manifests) {
    const pick = m.manifests.find((x) => x.platform?.os === 'linux' && x.platform.architecture === arch && !x.platform.variant) ?? m.manifests.find((x) => x.platform?.os === 'linux' && x.platform.architecture === arch)
    if (!pick) throw new Error(`в образе нет платформы linux/${arch}`)
    m = await (await authed(reg, repo, `manifests/${pick.digest}`, 'GET')).json() as Manifest
  }
  if (!m.config?.digest) throw new Error('в манифесте нет config')
  const cfg = await (await authed(reg, repo, `blobs/${m.config.digest}`, 'GET')).json() as ConfigBlob
  const created = cfg.created ? Date.parse(cfg.created) : NaN
  return { version: versionOf(cfg.config?.Labels), created: Number.isFinite(created) ? created : null }
}

// Кэш «digest → метаданные»: у неизменяемого digest метки не меняются, повторно в реестр не ходим
const META_KEY = 'updates.docker.remoteMeta'
const META_KEEP = 40
export function cachedMeta(digest: string): ImageMeta | null {
  return getSetting<Record<string, ImageMeta>>(META_KEY, {})[digest] ?? null
}
export function storeMeta(digest: string, meta: ImageMeta) {
  const all = getSetting<Record<string, ImageMeta>>(META_KEY, {})
  all[digest] = meta
  const keys = Object.keys(all)
  for (const k of keys.slice(0, Math.max(0, keys.length - META_KEEP))) delete all[k]
  setSetting(META_KEY, all)
}

export type LocalImage = {
  id: string
  digest: string | null
  created: number | null
  version: string | null
  arch: string
}

// Образ, который реально запущен в контейнере (а не то, на что сейчас указывает тег :latest)
export async function localImageOf(proxy: string, imageId: string, repo: string): Promise<LocalImage> {
  const i = await httpJson<{ Id: string; Created: string; Architecture?: string; RepoDigests?: string[] | null; Config?: { Labels?: Record<string, string> | null } }>(`${proxy}/images/${imageId}/json`)
  const created = Date.parse(i.Created)
  const digests = i.RepoDigests ?? []
  // digest для нужного репозитория (lscr.io/linuxserver/… и ghcr.io/linuxserver/… — один и тот же образ)
  const name = repo.replace(/^(lscr\.io|ghcr\.io|docker\.io)\//, '')
  const mine = digests.find((d) => d.replace(/^(lscr\.io|ghcr\.io|docker\.io)\//, '').startsWith(`${name}@`)) ?? digests[0]
  return {
    id: i.Id,
    digest: mine?.split('@')[1] ?? null,
    created: Number.isFinite(created) ? created : null,
    version: versionOf(i.Config?.Labels),
    arch: i.Architecture ?? 'amd64',
  }
}
