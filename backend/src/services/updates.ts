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
import { CONTAINER_WARNINGS } from './docker.js'
import { cachedMeta, localImageOf, RateLimited, remoteDigest, remoteMeta, storeMeta, type ImageMeta, type RegistryId } from './dockerRegistry.js'
import { managedInfo } from './dockerManage.js'
import { updateLock as qbUpdateLock } from './qbittorrent.js'

const api = (path: string) => `${config.dockerProxy}${path}`

// Контейнеры, для которых обновление требует повторного ввода пароля панели (даже если белый список не говорит об этом)
export const DANGEROUS = new Set(['portainer', 'adguardhome', 'qbittorrent', 'docker-socket-proxy'])

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

// «Живая» часть карточки (считается при выдаче, не кэшируется): подключён ли образ к кнопке «Обновить», замок и т. п.
export type DockerLive = {
  managed: boolean // контейнер в белом списке помощника — кнопка «Обновить» доступна
  recreateBlock: string | null // почему пересоздать нельзя (нет compose / compose не подключён), если managed=false
  lock: string | null // причина временного замка (например, идут закачки)
  note: string | null // постоянная пометка
  danger: boolean // нужно повторно ввести пароль панели
  warning: string | null // что произойдёт при обновлении
  rollback: { version: string | null; at: number } | null // доступен ли откат
}
export type DockerImageStatus = {
  container: string
  repo: string
  registry: RegistryId
  localDigest: string | null
  remoteDigest: string | null
  upToDate: boolean | null
  imageCreated: number | null // дата сборки запущенного образа
  remoteCreated: number | null // дата сборки образа в реестре
  localVersion: string | null // org.opencontainers.image.version запущенного образа
  remoteVersion: string | null // то же у образа в реестре
  composeProject: string | null // метка com.docker.compose.project контейнера
  checkedAt: number | null
  error: string | null
} & DockerLive
export type DockerUpdateEvent = { container: string; repo: string; oldDigest: string | null; newDigest: string; detectedAt: number }

// Все восемь контейнеров с образами. registry/path — где проверять (lscr.io — это ghcr.io)
export const DOCKER_TARGETS: Record<string, { image: string; registry: RegistryId; path: string; tag: string }> = {
  portainer: { image: 'portainer/portainer-ce', registry: 'hub', path: 'portainer/portainer-ce', tag: 'latest' },
  adguardhome: { image: 'adguard/adguardhome', registry: 'hub', path: 'adguard/adguardhome', tag: 'latest' },
  jellyfin: { image: 'jellyfin/jellyfin', registry: 'hub', path: 'jellyfin/jellyfin', tag: 'latest' },
  qbittorrent: { image: 'linuxserver/qbittorrent', registry: 'hub', path: 'linuxserver/qbittorrent', tag: 'latest' },
  sftpgo: { image: 'drakkan/sftpgo', registry: 'hub', path: 'drakkan/sftpgo', tag: 'latest' },
  'docker-socket-proxy': { image: 'lscr.io/linuxserver/socket-proxy', registry: 'ghcr', path: 'linuxserver/socket-proxy', tag: 'latest' },
  minimserver: { image: 'minimworld/minimserver', registry: 'hub', path: 'minimworld/minimserver', tag: 'latest' },
  bubbleupnpserver: { image: 'nventiveux/docker-bubbleupnpserver', registry: 'hub', path: 'nventiveux/docker-bubbleupnpserver', tag: 'latest' },
}

const DOCKER_KEY = 'updates.docker.cache2'
const DOCKER_LAST_DIGEST_KEY = 'updates.docker.lastDigest'
const DOCKER_TRACKING_SINCE_KEY = 'updates.docker.trackingSince'
const DOCKER_TTL_OK = 4 * 3600_000
const DOCKER_TTL_ERR = 30 * 60_000

type RawContainerLite = { Names: string[]; ImageID: string; Labels: Record<string, string> | null }
type Cached = Omit<DockerImageStatus, keyof DockerLive>

const insertDockerEvent = db.prepare(`INSERT INTO docker_image_updates (container, repo, old_digest, new_digest, detected_at) VALUES (?, ?, ?, ?, ?)`)

async function refreshDockerOne(container: string, ctr: RawContainerLite | undefined, prev: Cached | undefined): Promise<Cached> {
  const t = DOCKER_TARGETS[container]
  const base = { container, repo: t.image, registry: t.registry, composeProject: ctr?.Labels?.['com.docker.compose.project'] ?? null }
  try {
    if (!ctr) throw new Error('контейнер не найден')
    const local = await localImageOf(config.dockerProxy, ctr.ImageID, t.image)
    const remote = await remoteDigest(t.registry, t.path, t.tag)

    // Метки новой версии: тот же digest — метки наши; иначе из кэша по digest или из config blob реестра.
    // Сбой чтения меток не делает проверку ошибочной: «есть новее» известно по digest, версию просто не покажем.
    let meta: ImageMeta = { version: local.version, created: local.created }
    if (local.digest !== remote) {
      meta = cachedMeta(remote) ?? { version: null, created: null }
      if (!cachedMeta(remote)) {
        try {
          meta = await remoteMeta(t.registry, t.path, remote, local.arch)
          storeMeta(remote, meta)
        } catch (e) {
          if (e instanceof RateLimited) throw e
        }
      }
    }

    // Своя история (прошлого нет — отслеживаем с этого момента): замечаем смену ЛОКАЛЬНОГО digest,
    // то есть реальный pull на этом сервере, а не то, что upstream что-то выпустил
    if (local.digest) {
      if (getSetting<number | null>(DOCKER_TRACKING_SINCE_KEY, null) === null) setSetting(DOCKER_TRACKING_SINCE_KEY, Date.now())
      const lastMap = getSetting<Record<string, string>>(DOCKER_LAST_DIGEST_KEY, {})
      const prevLocal = lastMap[container]
      if (prevLocal && prevLocal !== local.digest) insertDockerEvent.run(container, t.image, prevLocal, local.digest, Date.now())
      lastMap[container] = local.digest
      setSetting(DOCKER_LAST_DIGEST_KEY, lastMap)
    }

    return {
      ...base,
      localDigest: local.digest,
      remoteDigest: remote,
      upToDate: local.digest ? local.digest === remote : null,
      imageCreated: local.created,
      remoteCreated: meta.created,
      localVersion: local.version,
      remoteVersion: meta.version,
      checkedAt: Date.now(),
      error: null,
    }
  } catch (e) {
    // Ошибка проверки: прежние версии и даты оставляем (чтобы карточка не пустела), но статус — «ошибка проверки»
    return {
      ...base,
      localDigest: prev?.localDigest ?? null,
      remoteDigest: prev?.remoteDigest ?? null,
      upToDate: null,
      imageCreated: prev?.imageCreated ?? null,
      remoteCreated: prev?.remoteCreated ?? null,
      localVersion: prev?.localVersion ?? null,
      remoteVersion: prev?.remoteVersion ?? null,
      checkedAt: Date.now(),
      error: (e as Error).message,
    }
  }
}

async function refreshDocker(force = false): Promise<void> {
  const cache = getSetting<Record<string, Cached>>(DOCKER_KEY, {})
  let ctrs: RawContainerLite[] | null = null
  for (const container of Object.keys(DOCKER_TARGETS)) {
    const c = cache[container]
    const ttl = c && !c.error ? DOCKER_TTL_OK : DOCKER_TTL_ERR
    if (!force && c?.checkedAt && Date.now() - c.checkedAt < ttl) continue
    ctrs ??= await httpJson<RawContainerLite[]>(api('/containers/json?all=1')).catch(() => [])
    const ctr = ctrs.find((x) => x.Names.some((n) => n.replace(/^\//, '') === container))
    cache[container] = await refreshDockerOne(container, ctr, c)
    setSetting(DOCKER_KEY, cache) // сохраняем после каждого — сбой одного образа не теряет уже проверенные
  }
}

// Имена пакетов, которые apt сейчас показывает как обновляемые (из кеша симуляции): проверка «можно ли обновлять»
export function upgradableNames(): Set<string> {
  const c = getSetting<AptCache | null>(APT_KEY, null)
  return new Set((c?.packages ?? []).map((p) => p.name))
}

// Временный замок обновления (null — можно). Пока только qBittorrent: незавершённые закачки; сбой проверки = замок (безопаснее)
export async function lockFor(container: string): Promise<string | null> {
  if (container !== 'qbittorrent') return null
  try {
    return await qbUpdateLock()
  } catch {
    return 'не удалось проверить закачки в qBittorrent'
  }
}

// Замок/пометки/признак «подключён к кнопке» — живые данные, в кэш проверки не попадают
async function liveFor(container: string, c: Cached): Promise<DockerLive> {
  const managed = await managedInfo(container)
  const lock = await lockFor(container)
  const note = container === 'qbittorrent' ? 'обновление — только после завершения закачек' : null
  const blockReason = c.composeProject ? 'compose-файл есть, но к панели не подключён' : 'нет compose-файла (контейнер создан через docker run)'
  return {
    managed: managed.managed,
    recreateBlock: managed.managed ? null : blockReason,
    lock,
    note,
    danger: managed.danger || DANGEROUS.has(container),
    warning: managed.warning ?? CONTAINER_WARNINGS[container] ?? null,
    rollback: managed.rollback,
  }
}

async function getDockerStatus(): Promise<DockerImageStatus[]> {
  const cache = getSetting<Record<string, Cached>>(DOCKER_KEY, {})
  return Promise.all(
    Object.entries(DOCKER_TARGETS).map(async ([container, t]) => {
      const c: Cached = cache[container] ?? {
        container,
        repo: t.image,
        registry: t.registry,
        localDigest: null,
        remoteDigest: null,
        upToDate: null,
        imageCreated: null,
        remoteCreated: null,
        localVersion: null,
        remoteVersion: null,
        composeProject: null,
        checkedAt: null,
        error: null,
      }
      return { ...c, ...(await liveFor(container, c)) }
    })
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
async function notifyUpdateChanges(): Promise<void> {
  const c = getSetting<AptCache | null>(APT_KEY, null)
  if (!c || c.error) return // ошибка проверки — не считаем это «обновлений нет»
  const docker = await getDockerStatus()
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
  listCache = null
  if (busy) return
  busy = true
  try {
    const aptCache = getSetting<AptCache | null>(APT_KEY, null)
    const ttl = aptCache && !aptCache.error ? APT_TTL_OK : APT_TTL_ERR
    if (force || !aptCache || Date.now() - aptCache.checkedAt > ttl) await refreshApt()
    await refreshDocker() // у каждого образа свой TTL внутри
    await notifyUpdateChanges()
  } finally {
    busy = false
  }
}

// Кнопка «Проверить сейчас»: принудительная проверка только Docker-образов (apt не трогаем). Не чаще раза в 15 секунд.
let lastManualCheck = 0
export async function checkDockerNow(): Promise<boolean> {
  if (busy || Date.now() - lastManualCheck < 15_000) return false
  lastManualCheck = Date.now()
  busy = true
  try {
    await refreshDocker(true)
    await notifyUpdateChanges()
  } finally {
    busy = false
    listCache = null
  }
  return true
}

// Обновить данные Docker-образов после обновления контейнера (без ограничения частоты ручной кнопки)
export async function refreshDockerNow(): Promise<void> {
  lastManualCheck = 0
  await checkDockerNow()
}

export function invalidateUpdatesCache() {
  listCache = null
}
let listCache: { at: number; data: UpdatesSnapshot } | null = null
export async function listUpdates(): Promise<UpdatesSnapshot> {
  if (listCache && Date.now() - listCache.at < 60_000) return listCache.data
  if (!getSetting<AptCache | null>(APT_KEY, null)) void refreshUpdates().catch(() => {})
  const data: UpdatesSnapshot = {
    apt: await getAptStatus(),
    docker: await getDockerStatus(),
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
