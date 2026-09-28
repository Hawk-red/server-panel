// Зеркало jetsetter, pulsdev-api (api.pulsdev.net), File Browser
import { readdir, readFile, stat } from 'node:fs/promises'
import https from 'node:https'
import tls from 'node:tls'
import { run, runMerged, sudo } from '../exec.js'
import { http } from '../http.js'

const SITE_ROOT = '/var/www/www/jetsetter.ua'
const SYNC_LOG = '/var/log/sync-jetsetter.log'
const PROD_CODE_BACKUP = '/mnt/backup-ssd/prod-code-backup'
const PULSDEV_DIR = '/home/hawk/pulsdev-api'
const API_DOMAIN = 'api.pulsdev.net'

type UnitInfo = { unit: string; active: string; sub: string; since: number | null }

export async function unitsInfo(units: string[]): Promise<UnitInfo[]> {
  const out = await run('/usr/bin/systemctl', ['show', '-p', 'Id,ActiveState,SubState,ActiveEnterTimestamp', ...units])
  return out
    .split('\n\n')
    .map((b) => Object.fromEntries(b.split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])))
    .filter((o) => o.Id)
    .map((o) => {
      const t = Date.parse(String(o.ActiveEnterTimestamp ?? '').replace(/ [A-Z]{3,5}$/, ''))
      return { unit: o.Id, active: o.ActiveState, sub: o.SubState, since: o.ActiveState === 'active' && Number.isFinite(t) ? t : null }
    })
}

// Версии компонентов стека (кэш 1 ч — меняются только при обновлениях)
let versionsCache: { at: number; data: Record<string, string | null> } | null = null
export async function stackVersions() {
  if (versionsCache && Date.now() - versionsCache.at < 3_600_000) return versionsCache.data
  const safe = async (fn: () => Promise<string | null>) => fn().catch(() => null)
  const data = {
    nginx: await safe(async () => (await runMerged('/usr/sbin/nginx', ['-v'])).match(/nginx\/([\d.]+)/)?.[1] ?? null),
    php: await safe(async () => (await run('/usr/sbin/php-fpm8.3', ['-v'])).match(/PHP ([\d.]+)/)?.[1] ?? null),
    mariadb: await safe(async () => (await run('/usr/bin/mariadb', ['--version'])).match(/Distrib ([\d.]+)/)?.[1] ?? null),
    mongod: await safe(async () => (await run('/usr/bin/mongod', ['--version'])).match(/db version v([\d.]+)/)?.[1] ?? null),
    wordpress: await safe(async () => (await readFile(`${SITE_ROOT}/wp-includes/version.php`, 'utf8')).match(/\$wp_version = '([^']+)'/)?.[1] ?? null),
  }
  versionsCache = { at: Date.now(), data }
  return data
}

// Ночной синк: последний запуск по маркерам в логе
export async function lastSync() {
  const text = await readFile(SYNC_LOG, 'utf8')
  const lines = text.split('\n')
  const startIdx = lines.map((l, i) => (l.includes('Початок синхронізації') ? i : -1)).filter((i) => i >= 0).pop()
  if (startIdx === undefined) return null
  const run_ = lines.slice(startIdx)
  const ts = (l: string) => {
    const m = l.match(/^\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\]/)
    return m ? Date.parse(m[1].replace(' ', 'T')) : null
  }
  const endLine = run_.find((l) => l.includes('Синхронізація завершена'))
  const started = ts(lines[startIdx])
  const finished = endLine ? ts(endLine) : null
  const errors = run_.filter((l) => /ERROR|помилк|FAILED|rsync error/i.test(l))
  return {
    started,
    finished,
    durationSec: started && finished ? Math.round((finished - started) / 1000) : null,
    status: !finished ? ('running-or-failed' as const) : errors.length ? ('warnings' as const) : ('ok' as const),
    errors: errors.slice(-10),
    tail: run_.slice(-40),
  }
}

// Последние изменённые записи WordPress (WP-CLI от www-data, одна фиксированная команда в sudoers)
export async function recentPosts() {
  const out = await sudo(
    [
      '-u',
      'www-data',
      '/usr/local/bin/wp',
      `--path=${SITE_ROOT}`,
      '--skip-plugins',
      '--skip-themes',
      'post',
      'list',
      '--post_type=post,page',
      '--orderby=modified',
      '--order=DESC',
      '--posts_per_page=15',
      '--fields=ID,post_title,post_type,post_status,post_modified',
      '--format=json',
    ],
    { timeoutMs: 30_000 }
  )
  return (JSON.parse(out) as { ID: number; post_title: string; post_type: string; post_status: string; post_modified: string }[]).map((p) => ({
    id: p.ID,
    title: p.post_title,
    type: p.post_type,
    status: p.post_status,
    modified: Date.parse(p.post_modified.replace(' ', 'T')),
  }))
}

// Изменённые файлы сайта за N дней (без uploads — это отдельная ФС, -xdev), кэш 10 мин
let filesCache: { at: number; data: { path: string; size: number; mtime: number }[] } | null = null
export async function recentFiles(days = 3) {
  if (filesCache && Date.now() - filesCache.at < 600_000) return filesCache.data
  const out = await run('/usr/bin/find', [SITE_ROOT, '-xdev', '-type', 'f', '-mtime', `-${days}`, '-not', '-path', '*/cache/*', '-not', '-path', '*/wflogs/*', '-printf', '%T@\t%s\t%P\n'], {
    timeoutMs: 30_000,
  }).catch((e) => (e.stdout as string) ?? '') // нечитаемые каталоги — не повод падать
  const data = out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [t, s, p] = l.split('\t')
      return { path: p, size: Number(s), mtime: Math.round(Number(t) * 1000) }
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 100)
  filesCache = { at: Date.now(), data }
  return data
}

export async function prodCodeBackup() {
  const dirs = (await readdir(PROD_CODE_BACKUP)).filter((d) => /^\d{4}-\d\d-\d\d$/.test(d)).sort()
  const latest = dirs.at(-1) ?? null
  const latestStat = latest ? await stat(`${PROD_CODE_BACKUP}/${latest}`) : null
  return { count: dirs.length, dates: dirs, latest, latestMtime: latestStat?.mtimeMs ?? null }
}

// Зеркало закрыто от интернета? allow/deny в server-блоке nginx
export async function mirrorExposure() {
  const conf = await readFile('/etc/nginx/sites-enabled/jetsetter.ua', 'utf8')
  const body = conf.replace(/#.*$/gm, '')
  const serverLevelDeny = /\n\s{4}deny all;/.test(body)
  const allows = [...body.matchAll(/^\s{4}allow ([^;]+);/gm)].map((m) => m[1])
  return { restricted: serverLevelDeny && allows.length > 0, allows }
}

// ---------- pulsdev-api ----------
export async function pulsdevVersion() {
  const pkg = JSON.parse(await readFile(`${PULSDEV_DIR}/package.json`, 'utf8'))
  return { name: pkg.name as string, version: pkg.version as string }
}

export async function pulsdevHealth() {
  const t0 = performance.now()
  const res = await http('http://127.0.0.1:8787/health', { timeoutMs: 5000 })
  const body = (await res.text()).slice(0, 200)
  return { ok: res.ok, ms: Math.round(performance.now() - t0), body }
}

// Через nginx + TLS (как видят снаружи), с проверкой цепочки сертификата
export function pulsdevHealthTls(): Promise<{ status: number; ms: number }> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now()
    const req = https.request(
      { host: '127.0.0.1', port: 443, path: '/health', servername: API_DOMAIN, headers: { Host: API_DOMAIN }, timeout: 5000 },
      (res) => {
        res.resume()
        res.on('end', () => resolve({ status: res.statusCode ?? 0, ms: Math.round(performance.now() - t0) }))
      }
    )
    req.on('timeout', () => req.destroy(new Error('таймаут')))
    req.on('error', reject)
    req.end()
  })
}

// Срок сертификата — из TLS-рукопожатия с локальным nginx (файлы /etc/letsencrypt закрыты)
export function certificate(): Promise<{ validTo: number; daysLeft: number; issuer: string | null; subject: string | null }> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: '127.0.0.1', port: 443, servername: API_DOMAIN, rejectUnauthorized: false, timeout: 5000 }, () => {
      const cert = socket.getPeerCertificate()
      socket.end()
      if (!cert?.valid_to) return reject(new Error('сертификат не получен'))
      const validTo = Date.parse(cert.valid_to)
      resolve({
        validTo,
        daysLeft: Math.floor((validTo - Date.now()) / 86_400_000),
        issuer: (cert.issuer?.O as string) ?? null,
        subject: (cert.subject?.CN as string) ?? null,
      })
    })
    socket.on('timeout', () => socket.destroy(new Error('таймаут TLS')))
    socket.on('error', reject)
  })
}
