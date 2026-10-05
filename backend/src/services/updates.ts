// Вкладка «Обновления» — ТОЛЬКО показ, установка не делается отсюда (пользователь ставит сам в терминале).
//
// apt: apt-get upgrade -s (симуляция, ничего не меняет) — проверено, работает от обычного пользователя panel
// без sudo (apt-daily.timer в Ubuntu сам держит кеш пакетов свежим). Короткое описание пакета — apt-cache show.
//
// Docker: все пять интересующих образов (portainer/adguard/jellyfin/qbittorrent/sftpgo) — с Docker Hub,
// тег :latest, поэтому сравнивать нужно не тег, а digest. Единственный надёжный способ узнать «есть ли
// новее» — заголовок Docker-Content-Digest на HEAD-запросе к /v2/<repo>/manifests/latest: это ТО ЖЕ самое
// значение, что Docker Engine пишет в RepoDigests локального образа после pull (проверено вручную на этой
// машине: локальный digest adguardhome совпал именно с этим заголовком, а не с digest конкретной платформы
// внутри manifest list). Локальный digest берём через уже разрешённый docker-socket-proxy (IMAGES=1).
//
// История apt — парсинг /var/log/apt/history.log (мирового чтения, sudo не нужен).
// История Docker-образов — своя: прошлого никто не логировал, поэтому мы начинаем замечать смену ЛОКАЛЬНОГО
// digest (то есть реальный pull на этом сервере) с момента первого запуска этой фичи и честно подписываем
// «отслеживаем с <дата>» — не притворяемся, что знаем историю до этого.
import { readFile, readdir } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { config } from '../config.js'
import { db } from '../db.js'
import { run } from '../exec.js'
import { http, httpJson } from '../http.js'
import { emitEvent, type EventLevel } from '../events.js'
import { getSetting, setSetting } from '../settings.js'

const api = (path: string) => `${config.dockerProxy}${path}`

// ---------- apt: доступные обновления ----------

export type AptPackage = { name: string; from: string; to: string; origin: string; security: boolean; description: string | null }
export type AptStatus = {
  checkedAt: number | null
  error: string | null
  packages: AptPackage[]
  securityCount: number
  heldBack: string[]
  rebootRequired: { required: boolean; pkgs: string[] }
}
type AptCache = { checkedAt: number; error: string | null; packages: AptPackage[]; heldBack: string[] }

const APT_KEY = 'updates.apt.cache'
const APT_TTL_OK = 4 * 3600_000
const APT_TTL_ERR = 30 * 60_000

async function rebootRequired(): Promise<{ required: boolean; pkgs: string[] }> {
  try {
    await readFile('/var/lib/update-notifier/reboot-required')
  } catch {
    return { required: false, pkgs: [] }
  }
  let pkgs: string[] = []
  try {
    pkgs = (await readFile('/var/lib/update-notifier/reboot-required.pkgs', 'utf8')).split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    /* список причин бывает не всегда — сам флаг важнее */
  }
  return { required: true, pkgs }
}

// Пример: Inst linux-libc-dev [6.8.0-142.142] (6.8.0-146.146 Ubuntu:24.04/noble-updates [amd64])
// Формат стабилен только для `apt-get upgrade -s` (без dist-upgrade) — там не бывает новых пакетов,
// только версии уже установленных, поэтому строка всегда содержит [старая-версия].
const INST_RE = /^Inst (\S+) \[([^\]]+)\] \(([^ ]+) ([^)]+)\)/
const HELD_HEADER_RE = /^(?:The following packages have been kept back|The following upgrades have been deferred due to phasing):\s*$/

async function simulateUpgrade(): Promise<{ packages: Omit<AptPackage, 'description'>[]; heldBack: string[] }> {
  const out = await run('/usr/bin/apt-get', ['upgrade', '-s'], { timeoutMs: 20_000 })
  const lines = out.split('\n')
  const packages: Omit<AptPackage, 'description'>[] = []
  for (const line of lines) {
    const m = line.match(INST_RE)
    if (!m) continue
    const [, name, from, to, originArch] = m
    const origin = originArch.replace(/\s*\[[^\]]*\]\s*$/, '').trim()
    packages.push({ name, from, to, origin, security: /-security/i.test(origin) })
  }
  // «придержанные» пакеты печатаются отдельным блоком: заголовок + одна/несколько строк с отступом
  const heldBack: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!HELD_HEADER_RE.test(lines[i])) continue
    for (let j = i + 1; j < lines.length && /^\s/.test(lines[j]); j++) heldBack.push(...lines[j].trim().split(/\s+/))
  }
  return { packages, heldBack: [...new Set(heldBack)] }
}

// apt-cache show pkg1=ver1 pkg2=ver2 ... — описание первой строкой в Description(-en):
async function descriptions(pkgs: { name: string; to: string }[]): Promise<Record<string, string>> {
  if (!pkgs.length) return {}
  let out = ''
  try {
    out = await run('/usr/bin/apt-cache', ['show', ...pkgs.map((p) => `${p.name}=${p.to}`)], { timeoutMs: 20_000 })
  } catch {
    return {}
  }
  const result: Record<string, string> = {}
  let curPkg: string | null = null
  for (const line of out.split('\n')) {
    const pkgM = line.match(/^Package: (\S+)/)
    if (pkgM) curPkg = pkgM[1]
    const descM = line.match(/^Description(?:-\w+)?: (.+)/)
    if (descM && curPkg && !result[curPkg]) result[curPkg] = descM[1].trim().slice(0, 100)
  }
  return result
}

async function refreshApt(): Promise<void> {
  try {
    const { packages: raw, heldBack } = await simulateUpgrade()
    const desc = await descriptions(raw)
    const packages = raw.map((p) => ({ ...p, description: desc[p.name] ?? null }))
    setSetting(APT_KEY, { checkedAt: Date.now(), error: null, packages, heldBack } satisfies AptCache)
  } catch (e) {
    const prev = getSetting<AptCache | null>(APT_KEY, null)
    setSetting(APT_KEY, { checkedAt: Date.now(), error: (e as Error).message, packages: prev?.packages ?? [], heldBack: prev?.heldBack ?? [] } satisfies AptCache)
  }
}

async function getAptStatus(): Promise<AptStatus> {
  const c = getSetting<AptCache | null>(APT_KEY, null)
  const reboot = await rebootRequired() // дёшево (чтение файла) — не кешируем, смотрим каждый раз свежим
  if (!c) return { checkedAt: null, error: null, packages: [], securityCount: 0, heldBack: [], rebootRequired: reboot }
  return { checkedAt: c.checkedAt, error: c.error, packages: c.packages, securityCount: c.packages.filter((p) => p.security).length, heldBack: c.heldBack, rebootRequired: reboot }
}

// ---------- apt: история установленного ----------

export type AptHistoryEntry = { date: number; manual: boolean; packages: { name: string; from: string | null; to: string }[] }

// Находит все «имя (старая, новая)» / «имя (версия)» в строке Upgrade:/Install:, не ломаясь на том,
// что между пакетами тот же разделитель «, », что и внутри пары версий — матчим целиком, не сплитим.
function parsePackageList(raw: string): { name: string; from: string | null; to: string }[] {
  const out: { name: string; from: string | null; to: string }[] = []
  const re = /(\S+)\s\(([^()]+)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const name = m[1].replace(/:\S+$/, '')
    const parts = m[2].split(', ').map((s) => s.trim())
    out.push(parts.length > 1 ? { name, from: parts[0], to: parts[1] } : { name, from: null, to: parts[0] })
  }
  return out
}

function parseHistoryBlock(block: string): AptHistoryEntry | null {
  const dateM = block.match(/^Start-Date: (.+)$/m)
  const cmdM = block.match(/^Commandline: (.+)$/m)
  const upgradeM = block.match(/^(?:Upgrade|Install): (.+)$/m)
  if (!dateM || !upgradeM) return null
  // apt разделяет дату и время ДВУМЯ пробелами — заменяем весь пробельный разрыв на T, не только первый пробел
  const date = Date.parse(dateM[1].trim().replace(/\s+/, 'T'))
  if (!Number.isFinite(date)) return null
  return { date, manual: !/unattended-upgrade/.test(cmdM?.[1] ?? ''), packages: parsePackageList(upgradeM[1]) }
}

async function readMaybeGz(path: string): Promise<string> {
  return path.endsWith('.gz') ? gunzipSync(await readFile(path)).toString('utf8') : readFile(path, 'utf8')
}

export async function aptHistory(limit = 150): Promise<AptHistoryEntry[]> {
  const dir = '/var/log/apt'
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => /^history\.log(\.\d+\.gz)?$/.test(f))
  } catch {
    return []
  }
  files.sort((a, b) => (a === 'history.log' ? -1 : b === 'history.log' ? 1 : a.localeCompare(b)))
  const entries: AptHistoryEntry[] = []
  for (const f of files) {
    try {
      for (const block of (await readMaybeGz(`${dir}/${f}`)).split(/\n\n+/)) {
        const e = parseHistoryBlock(block)
        if (e) entries.push(e)
      }
    } catch {
      /* ротированный файл мог исчезнуть между readdir и чтением — пропускаем */
    }
    if (entries.length >= limit * 2) break // достаточно сырых записей, дальше просто сортировка/обрезка
  }
  return entries.sort((a, b) => b.date - a.date).slice(0, limit)
}

// ---------- docker: доступные обновления ----------

export type DockerImageStatus = {
  container: string
  repo: string
  localDigest: string | null
  remoteDigest: string | null
  upToDate: boolean | null
  imageCreated: number | null
  checkedAt: number | null
  error: string | null
}
export type DockerUpdateEvent = { container: string; repo: string; oldDigest: string | null; newDigest: string; detectedAt: number }

// Только контейнеры из задачи — каждый на Docker Hub под :latest
const DOCKER_TARGETS: Record<string, string> = {
  portainer: 'portainer/portainer-ce',
  adguardhome: 'adguard/adguardhome',
  jellyfin: 'jellyfin/jellyfin',
  qbittorrent: 'linuxserver/qbittorrent',
  sftpgo: 'drakkan/sftpgo',
}

const DOCKER_KEY = 'updates.docker.cache'
const DOCKER_LAST_DIGEST_KEY = 'updates.docker.lastDigest'
const DOCKER_TRACKING_SINCE_KEY = 'updates.docker.trackingSince'
const DOCKER_TTL_OK = 4 * 3600_000
const DOCKER_TTL_ERR = 30 * 60_000

type RawImage = { RepoTags: string[] | null; RepoDigests: string[] | null; Created: number }

async function localImage(repo: string): Promise<{ digest: string | null; created: number | null }> {
  const images = await httpJson<RawImage[]>(api('/images/json'))
  const img = images.find((i) => (i.RepoTags ?? []).includes(`${repo}:latest`))
  if (!img) return { digest: null, created: null }
  return { digest: (img.RepoDigests ?? []).map((d) => d.split('@')[1]).find(Boolean) ?? null, created: img.Created * 1000 }
}

async function remoteDigest(repo: string): Promise<string> {
  const { token } = await httpJson<{ token: string }>(`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`, { timeoutMs: 10_000 })
  const res = await http(`https://registry-1.docker.io/v2/${repo}/manifests/latest`, {
    method: 'HEAD',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json' },
    timeoutMs: 10_000,
  })
  const digest = res.headers.get('docker-content-digest')
  if (!digest) throw new Error('реестр не вернул digest')
  return digest
}

const insertDockerEvent = db.prepare(`INSERT INTO docker_image_updates (container, repo, old_digest, new_digest, detected_at) VALUES (?, ?, ?, ?, ?)`)

async function refreshDockerOne(container: string, repo: string): Promise<DockerImageStatus> {
  try {
    const [{ digest: localDigest, created }, remote] = await Promise.all([localImage(repo), remoteDigest(repo)])

    // Своя история (прошлого нет — отслеживаем с этого момента): замечаем смену ЛОКАЛЬНОГО digest,
    // то есть реальный pull на этом сервере, а не то, что upstream что-то выпустил
    if (localDigest) {
      if (getSetting<number | null>(DOCKER_TRACKING_SINCE_KEY, null) === null) setSetting(DOCKER_TRACKING_SINCE_KEY, Date.now())
      const lastMap = getSetting<Record<string, string>>(DOCKER_LAST_DIGEST_KEY, {})
      const prevLocal = lastMap[container]
      if (prevLocal && prevLocal !== localDigest) insertDockerEvent.run(container, repo, prevLocal, localDigest, Date.now())
      lastMap[container] = localDigest
      setSetting(DOCKER_LAST_DIGEST_KEY, lastMap)
    }

    return { container, repo, localDigest, remoteDigest: remote, upToDate: localDigest ? localDigest === remote : null, imageCreated: created, checkedAt: Date.now(), error: null }
  } catch (e) {
    return { container, repo, localDigest: null, remoteDigest: null, upToDate: null, imageCreated: null, checkedAt: Date.now(), error: (e as Error).message }
  }
}

async function refreshDocker(): Promise<void> {
  const cache = getSetting<Record<string, DockerImageStatus>>(DOCKER_KEY, {})
  for (const [container, repo] of Object.entries(DOCKER_TARGETS)) {
    const c = cache[container]
    const ttl = c && !c.error ? DOCKER_TTL_OK : DOCKER_TTL_ERR
    if (c?.checkedAt && Date.now() - c.checkedAt < ttl) continue
    cache[container] = await refreshDockerOne(container, repo)
    setSetting(DOCKER_KEY, cache) // сохраняем после каждого — сбой одного образа не теряет уже проверенные
  }
}

// Имена пакетов, которые apt сейчас показывает как обновляемые (из кеша симуляции): проверка «можно ли обновлять»
export function upgradableNames(): Set<string> {
  const c = getSetting<AptCache | null>(APT_KEY, null)
  return new Set((c?.packages ?? []).map((p) => p.name))
}

function getDockerStatus(): DockerImageStatus[] {
  const cache = getSetting<Record<string, DockerImageStatus>>(DOCKER_KEY, {})
  return Object.entries(DOCKER_TARGETS).map(
    ([container, repo]) => cache[container] ?? { container, repo, localDigest: null, remoteDigest: null, upToDate: null, imageCreated: null, checkedAt: null, error: null }
  )
}

const selectDockerEvents = db.prepare(
  `SELECT container, repo, old_digest as oldDigest, new_digest as newDigest, detected_at as detectedAt FROM docker_image_updates ORDER BY detected_at DESC LIMIT ?`
)
function dockerHistory(limit = 100): DockerUpdateEvent[] {
  return selectDockerEvents.all(limit) as DockerUpdateEvent[]
}

// ---------- сборка снимка для фронта ----------

export type UpdatesSnapshot = {
  apt: AptStatus
  docker: DockerImageStatus[]
  dockerTrackingSince: number | null
  aptHistory: AptHistoryEntry[]
  dockerHistory: DockerUpdateEvent[]
}

// ---------- уведомления об изменениях (сравнение с прошлым состоянием, без повторов) ----------

// Что уже сообщили: список пакетов, security-пакеты, флаг перезагрузки, и для Docker — remote digest,
// о котором уже сообщили. Хранится в settings, поэтому после перезапуска панели старое не шлётся заново.
export type NotifyState = { apt: string[]; security: string[]; reboot: boolean; docker: Record<string, string> }
export type UpdateEvent = { kind: 'updates.apt' | 'updates.security' | 'updates.reboot' | 'updates.docker'; level: EventLevel; text: string; target?: string | null; details: Record<string, unknown> }

const NOTIFY_KEY = 'updates.notify.state'

// Чистая функция: по прошлому состоянию и текущему списку решает, что сообщить. Первый запуск (state нет) —
// только запоминаем базу, без событий, чтобы не слать весь текущий список при установке.
export function diffUpdates(
  prev: NotifyState | null,
  cur: { apt: { name: string; security: boolean }[]; reboot: boolean; docker: { container: string; repo: string; upToDate: boolean | null; remoteDigest: string | null }[] }
): { events: UpdateEvent[]; next: NotifyState } {
  const names = cur.apt.map((p) => p.name).sort()
  const security = cur.apt.filter((p) => p.security).map((p) => p.name).sort()
  const dockerNext: Record<string, string> = {}
  for (const d of cur.docker) {
    if (d.upToDate === false && d.remoteDigest) dockerNext[d.container] = prev?.docker[d.container] ?? ''
    else if (d.upToDate === null && prev?.docker[d.container]) dockerNext[d.container] = prev.docker[d.container] // ошибка проверки — ничего не меняем
  }
  const next: NotifyState = { apt: names, security, reboot: cur.reboot, docker: dockerNext }
  if (!prev) {
    // База для будущих сравнений: докер-digest, о котором уже «знаем», но не сообщаем
    for (const d of cur.docker) if (d.upToDate === false && d.remoteDigest) next.docker[d.container] = d.remoteDigest
    return { events: [], next }
  }

  const events: UpdateEvent[] = []
  const was = new Set(prev.apt)
  const newNames = names.filter((n) => !was.has(n))
  if (newNames.length > 0) {
    events.push({
      kind: 'updates.apt',
      level: 'info',
      text: `Доступны новые обновления: ${names.length} пакетов`,
      target: 'apt',
      details: { total: names.length, security: security.length, newCount: newNames.length, reboot: cur.reboot },
    })
  }
  const wasSec = new Set(prev.security)
  const newSec = security.filter((n) => !wasSec.has(n))
  if (newSec.length > 0) {
    events.push({
      kind: 'updates.security',
      level: 'warning',
      text: `${newSec.length} обновлений безопасности`,
      target: 'apt',
      details: { count: newSec.length, names: newSec.slice(0, 15), total: security.length },
    })
  }
  if (cur.reboot && !prev.reboot) {
    events.push({ kind: 'updates.reboot', level: 'warning', text: 'Нужна перезагрузка сервера', target: 'reboot', details: {} })
  }
  for (const d of cur.docker) {
    if (d.upToDate !== false || !d.remoteDigest) continue
    if (prev.docker[d.container] === d.remoteDigest) continue // уже сообщали об этой версии
    events.push({
      kind: 'updates.docker',
      level: 'info',
      text: `Новая версия образа: ${d.container}`,
      target: d.container,
      details: { container: d.container, repo: d.repo },
    })
    next.docker[d.container] = d.remoteDigest
  }
  return { events, next }
}

// Сравниваем текущие данные (apt-кеш и Docker-кеш) с сохранённым состоянием и публикуем только изменения
function notifyUpdateChanges(): void {
  const c = getSetting<AptCache | null>(APT_KEY, null)
  if (!c || c.error) return // ошибка проверки — не считаем это «обновлений нет»
  const docker = getDockerStatus()
  const cur = {
    apt: c.packages.map((p) => ({ name: p.name, security: p.security })),
    reboot: false, // подставляется ниже из флага reboot-required
    docker: docker.map((d) => ({ container: d.container, repo: d.repo, upToDate: d.upToDate, remoteDigest: d.remoteDigest })),
  }
  void rebootRequired().then((r) => {
    cur.reboot = r.required
    const prev = getSetting<NotifyState | null>(NOTIFY_KEY, null)
    const { events, next } = diffUpdates(prev, cur)
    setSetting(NOTIFY_KEY, next)
    for (const e of events) emitEvent({ kind: e.kind, level: e.level, text: e.text, target: e.target, details: e.details })
  })
}

let busy = false
export async function refreshUpdates(force = false): Promise<void> {
  if (busy) return
  busy = true
  try {
    const aptCache = getSetting<AptCache | null>(APT_KEY, null)
    const ttl = aptCache && !aptCache.error ? APT_TTL_OK : APT_TTL_ERR
    if (force || !aptCache || Date.now() - aptCache.checkedAt > ttl) await refreshApt()
    await refreshDocker() // у каждого образа свой TTL внутри
    notifyUpdateChanges()
  } finally {
    busy = false
  }
}

let listCache: { at: number; data: UpdatesSnapshot } | null = null
export async function listUpdates(): Promise<UpdatesSnapshot> {
  if (listCache && Date.now() - listCache.at < 60_000) return listCache.data
  if (!getSetting<AptCache | null>(APT_KEY, null)) void refreshUpdates().catch(() => {})
  const data: UpdatesSnapshot = {
    apt: await getAptStatus(),
    docker: getDockerStatus(),
    dockerTrackingSince: getSetting<number | null>(DOCKER_TRACKING_SINCE_KEY, null),
    aptHistory: await aptHistory(),
    dockerHistory: dockerHistory(),
  }
  listCache = { at: Date.now(), data }
  return data
}

export function startUpdates() {
  setTimeout(() => void refreshUpdates().catch(() => {}), 15_000)
  setInterval(() => void refreshUpdates().catch(() => {}), 3600_000)
}
