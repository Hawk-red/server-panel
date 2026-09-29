// Бэкапы (этап 10.3): синк jetsetter, prod-code-backup, снимки iPad, разовые копии «перед обновлением».
// Возраст считаем по mtime; «устарела» — старше порога. Размеры считаются медленно (du) —
// в фоне и с кэшем; то, что читается только от root (iPad, pre-upgrade), — через server-panel-helper.
import { readdir, stat } from 'node:fs/promises'
import { run } from '../exec.js'
import { helper } from './access.js'
import { lastSync } from './sites.js'

const BACKUP_ROOT = '/mnt/backup-ssd'
const SYNC_DB_DIR = `${BACKUP_ROOT}/sync-jetsetter/database`
const PROD_CODE_DIR = `${BACKUP_ROOT}/prod-code-backup`
const HOUR = 3_600_000

export type BackupStatus = 'ok' | 'stale' | 'missing' | 'nodata'
export type BackupItem = {
  id: string
  title: string
  description: string
  path: string
  /** scheduled — должна обновляться по расписанию (есть порог); oneoff — разовая копия */
  type: 'scheduled' | 'oneoff'
  maxAgeH: number | null
  status: BackupStatus
  /** причина статуса nodata / пояснение */
  note: string | null
  latest: { name: string; mtime: number } | null
  ageSec: number | null
  count: number | null
  sizeBytes: number | null
  /** размер всех копий этого типа */
  totalBytes: number | null
  entries?: { name: string; mtime: number | null; sizeBytes: number | null; note?: string }[]
  extra?: Record<string, unknown>
}

// ---------- размеры: du в фоне, кэш ----------
const sizeCache = new Map<string, { at: number; value: number | null }>()
const sizeBusy = new Set<string>()
function cachedSize(path: string, ttl = 6 * HOUR): number | null {
  const c = sizeCache.get(path)
  if (!c || Date.now() - c.at > ttl) {
    if (!sizeBusy.has(path)) {
      sizeBusy.add(path)
      run('/usr/bin/du', ['-sb', path], { timeoutMs: 120_000 })
        .catch((e) => (e.stdout as string) ?? '') // нечитаемые подкаталоги — не повод терять сумму
        .then((out) => sizeCache.set(path, { at: Date.now(), value: Number(out.split('\t')[0]) || null }))
        .finally(() => sizeBusy.delete(path))
    }
  }
  return c?.value ?? null
}

// Размеры от root (helper backups-sizes): раз в 6 часов, du по iPad-снимкам может идти минуту
type RootSizes = { at: number; sizes: Record<string, number>; error: string | null }
let rootSizes: RootSizes | null = null
let rootBusy = false
function refreshRootSizes() {
  if (rootBusy || (rootSizes && Date.now() - rootSizes.at < 6 * HOUR && !rootSizes.error)) return
  if (rootSizes?.error && Date.now() - rootSizes.at < 10 * 60_000) return
  rootBusy = true
  helper(['backups-sizes'], 170_000)
    .then((out) => {
      const sizes: Record<string, number> = {}
      for (const l of out.split('\n')) {
        const [p, n] = l.split('\t')
        if (p && Number.isFinite(Number(n))) sizes[p] = Number(n)
      }
      rootSizes = { at: Date.now(), sizes, error: null }
    })
    .catch((e) => (rootSizes = { at: Date.now(), sizes: rootSizes?.sizes ?? {}, error: helperError(e) }))
    .finally(() => (rootBusy = false))
}

function helperError(e: unknown) {
  const msg = ((e as { stderr?: string }).stderr || (e as Error).message || '').trim()
  if (/неизвестная команда/.test(msg)) return 'helper устарел — нужно установить обновлённый server-panel-helper (sudo-блок)'
  if (/password is required|not allowed|sudoers/i.test(msg)) return 'нет прав (sudoers)'
  return msg.slice(0, 200) || 'ошибка helper'
}

const ageOf = (mtime: number | null) => (mtime === null ? null : Math.max(0, Math.round((Date.now() - mtime) / 1000)))
function scheduledStatus(ageSec: number | null, maxAgeH: number): BackupStatus {
  return ageSec === null ? 'missing' : ageSec > maxAgeH * 3600 ? 'stale' : 'ok'
}

// ---------- отдельные копии ----------
async function syncJetsetter(): Promise<BackupItem> {
  const maxAgeH = 36
  const base: BackupItem = {
    id: 'sync-jetsetter',
    title: 'Синк jetsetter (дамп БД)',
    description: 'Ночной синк с прода в 05:00: дамп MySQL приходит в /mnt/backup-ssd/sync-jetsetter/database, хранится 30 дней.',
    path: SYNC_DB_DIR,
    type: 'scheduled',
    maxAgeH,
    status: 'nodata',
    note: null,
    latest: null,
    ageSec: null,
    count: null,
    sizeBytes: null,
    totalBytes: null,
  }
  try {
    const files = (await readdir(SYNC_DB_DIR)).filter((f) => /\.sql(\.gz)?$/.test(f))
    const infos = await Promise.all(files.map(async (f) => ({ name: f, st: await stat(`${SYNC_DB_DIR}/${f}`) })))
    infos.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)
    base.count = infos.length
    base.totalBytes = infos.reduce((s, i) => s + i.st.size, 0)
    if (infos[0]) {
      base.latest = { name: infos[0].name, mtime: infos[0].st.mtimeMs }
      base.sizeBytes = infos[0].st.size
    }
    base.ageSec = ageOf(base.latest?.mtime ?? null)
    base.status = scheduledStatus(base.ageSec, maxAgeH)
    // Предыдущий дамп заметно меньше — признак обрезанной копии
    if (infos.length >= 2 && infos[0].st.size < infos[1].st.size * 0.8) base.note = 'Последний дамп заметно меньше предыдущего — проверьте, что он полный.'
  } catch (e) {
    base.note = (e as NodeJS.ErrnoException).code === 'EACCES' ? 'нет доступа к каталогу' : 'каталог с дампами не найден'
  }
  // Как закончился последний синк
  const sync = await lastSync().catch(() => null)
  base.extra = {
    sync: sync
      ? { started: sync.started, finished: sync.finished, durationSec: sync.durationSec, status: sync.status, errors: sync.errors.length }
      : null,
  }
  return base
}

async function prodCode(): Promise<BackupItem> {
  const maxAgeH = 36
  const item: BackupItem = {
    id: 'prod-code',
    title: 'prod-code-backup',
    description: 'Архив папки wp-content боевого jetsetter.ua (темы, плагины, загрузки) — запасная копия на случай сбоя или удаления на проде. Забирается с боевого сервера ночным синком в 05:00 (шаг 5 из 7) в /mnt/backup-ssd/prod-code-backup/ГГГГ-ММ-ДД/, на зеркало не разворачивается; хранятся последние 7 дней.',
    path: PROD_CODE_DIR,
    type: 'scheduled',
    maxAgeH,
    status: 'nodata',
    note: null,
    latest: null,
    ageSec: null,
    count: null,
    sizeBytes: null,
    totalBytes: null,
  }
  try {
    const dirs = (await readdir(PROD_CODE_DIR)).filter((d) => /^\d{4}-\d\d-\d\d$/.test(d)).sort()
    item.count = dirs.length
    const latest = dirs.at(-1)
    if (latest) {
      const st = await stat(`${PROD_CODE_DIR}/${latest}`)
      item.latest = { name: latest, mtime: st.mtimeMs }
      item.sizeBytes = cachedSize(`${PROD_CODE_DIR}/${latest}`)
    }
    item.totalBytes = cachedSize(PROD_CODE_DIR)
    item.ageSec = ageOf(item.latest?.mtime ?? null)
    item.status = scheduledStatus(item.ageSec, maxAgeH)
  } catch (e) {
    item.note = (e as NodeJS.ErrnoException).code === 'EACCES' ? 'нет доступа к каталогу' : 'каталог не найден'
  }
  return item
}

async function ipad(): Promise<BackupItem> {
  const maxAgeH = 48
  const item: BackupItem = {
    id: 'ipad',
    title: 'Бэкапы iPad',
    description: 'MacBook присылает копию iPad на сервер (метка .backup-complete), в 23:59 делается снимок; хранятся 14 дневных и 8 недельных.',
    path: '/srv/ipad-backups',
    type: 'scheduled',
    maxAgeH,
    status: 'nodata',
    note: null,
    latest: null,
    ageSec: null,
    count: null,
    sizeBytes: null,
    totalBytes: null,
  }
  try {
    const out = await helper(['backups-ipad'], 20_000)
    const snaps: { name: string; mtime: number }[] = []
    let marker: number | null = null
    let free: number | null = null
    for (const l of out.split('\n')) {
      const [kind, a, b] = l.split('\t')
      if (kind === 'snap') snaps.push({ name: a, mtime: Number(b) * 1000 })
      else if (kind === 'marker') marker = Number(a) * 1000
      else if (kind === 'free') free = Number(a)
    }
    snaps.sort((x, y) => y.name.localeCompare(x.name))
    item.count = snaps.length
    // Возраст — по последней ПОЛНОЙ выгрузке (метка), а не по каталогу
    item.latest = marker ? { name: 'последняя полная выгрузка', mtime: marker } : snaps[0] ? { name: `снимок ${snaps[0].name}`, mtime: snaps[0].mtime } : null
    item.ageSec = ageOf(item.latest?.mtime ?? null)
    item.status = scheduledStatus(item.ageSec, maxAgeH)
    item.entries = snaps.slice(0, 8).map((s) => ({ name: s.name, mtime: s.mtime, sizeBytes: null }))
    item.extra = { freeBytes: free, lastSnapshot: snaps[0]?.name ?? null }
  } catch (e) {
    item.note = helperError(e)
    return item
  }
  refreshRootSizes()
  const cur = rootSizes?.sizes['/srv/ipad-backups/current']
  const snaps = rootSizes?.sizes['/srv/ipad-backups/snapshots']
  item.sizeBytes = cur ?? null
  item.totalBytes = cur != null && snaps != null ? cur + snaps : null
  item.extra = { ...item.extra, snapshotsExtraBytes: snaps ?? null, sizesPending: rootSizes === null || Boolean(rootSizes.error), sizesError: rootSizes?.error ?? null }
  return item
}

const ONEOFF = [
  { dir: 'pre-upgrade-2024.04', title: 'Перед обновлением до Ubuntu 24.04', note: 'все БД, /etc, скрипты, Mongo — 26.06.2026' },
  { dir: 'pre-update-backup', title: 'Перед обновлением WordPress 7 (июнь)', note: 'дампы БД и файлы сайта — 03.06.2026' },
  { dir: 'wp-pre-update-20260913', title: 'Перед обновлением WordPress (сентябрь)', note: 'полный дамп сайта — 13.09.2026' },
]
async function preUpgrade(): Promise<BackupItem> {
  const item: BackupItem = {
    id: 'pre-upgrade',
    title: 'Копии «перед обновлением»',
    description: 'Разовые копии перед крупными обновлениями. По расписанию не обновляются — устаревшими не считаются; удалять — только вручную.',
    path: BACKUP_ROOT,
    type: 'oneoff',
    maxAgeH: null,
    status: 'ok',
    note: null,
    latest: null,
    ageSec: null,
    count: 0,
    sizeBytes: null,
    totalBytes: null,
    entries: [],
  }
  refreshRootSizes()
  let total = 0
  let known = 0
  for (const o of ONEOFF) {
    const p = `${BACKUP_ROOT}/${o.dir}`
    try {
      const st = await stat(p)
      // Каталог с 700 у другого пользователя — размер только через helper
      const size = rootSizes?.sizes[p] ?? cachedSize(p, 24 * HOUR)
      if (size != null) {
        total += size
        known++
      }
      item.entries!.push({ name: o.dir, mtime: st.mtimeMs, sizeBytes: size ?? null, note: `${o.title}: ${o.note}` })
      if (!item.latest || st.mtimeMs > item.latest.mtime) item.latest = { name: o.dir, mtime: st.mtimeMs }
    } catch {
      /* каталога уже нет — пропускаем */
    }
  }
  item.count = item.entries!.length
  item.totalBytes = known === item.count && known > 0 ? total : null
  item.ageSec = ageOf(item.latest?.mtime ?? null)
  if (item.count === 0) item.note = 'разовых копий на диске нет'
  else if (known < item.count) item.note = rootSizes?.error ? `размеры части копий недоступны: ${rootSizes.error}` : 'размеры считаются…'
  return item
}

let cache: { at: number; data: BackupItem[] } | null = null
export async function backupsOverview(): Promise<BackupItem[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.data
  const data = await Promise.all([syncJetsetter(), prodCode(), ipad(), preUpgrade()])
  cache = { at: Date.now(), data }
  return data
}

// Для уведомлений и проблем: только копии с расписанием, не ok
export async function staleBackups() {
  return (await backupsOverview()).filter((b) => b.type === 'scheduled' && (b.status === 'stale' || b.status === 'missing'))
}
