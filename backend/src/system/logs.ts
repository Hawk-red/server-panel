import { open, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { run } from '../exec.js'
import { containerLogs, listContainers } from '../services/docker.js'

export type LogLevel = 'error' | 'warning' | 'info' | 'debug'
export type LogLine = { ts: number | null; level: LogLevel; text: string }
export type LogSource = { id: string; title: string; kind: 'journal' | 'file' | 'container'; group: string; path?: string; size?: number; readable?: boolean }

// Известные логи вне /var/log или с понятными названиями
const KNOWN_FILES: { path: string; title: string; group: string }[] = [
  { path: '/var/log/sync-jetsetter.log', title: 'Ночной синк jetsetter', group: 'Сайты' },
  { path: '/var/log/nginx/access.log', title: 'nginx — access', group: 'Сайты' },
  { path: '/var/log/nginx/error.log', title: 'nginx — error', group: 'Сайты' },
  { path: '/var/log/fail2ban.log', title: 'fail2ban', group: 'Безопасность' },
  { path: '/var/log/ufw.log', title: 'ufw (файрвол)', group: 'Безопасность' },
  { path: '/var/log/auth.log', title: 'auth.log (входы, sudo)', group: 'Безопасность' },
  { path: '/home/hawk/disk-monitor.log', title: 'disk-monitor', group: 'Диски' },
  { path: '/var/log/torrent-move.log', title: 'torrent-space-guard', group: 'Торренты' },
  { path: '/opt/alert_monitor/alert_monitor.log', title: 'Air Alert Monitor (бот тревог)', group: 'Автоматизация' },
  { path: '/var/log/syslog', title: 'syslog', group: 'Система' },
  { path: '/var/log/kern.log', title: 'Ядро (kern.log)', group: 'Система' },
]

// Журнал systemd: основные службы сервера
const JOURNAL_UNITS: { unit: string; title: string; group: string }[] = [
  { unit: 'server-panel.service', title: 'Панель (server-panel)', group: 'Панель' },
  { unit: 'nginx.service', title: 'nginx', group: 'Сайты' },
  { unit: 'php8.3-fpm.service', title: 'PHP-FPM', group: 'Сайты' },
  { unit: 'mariadb.service', title: 'MariaDB', group: 'Сайты' },
  { unit: 'mongod.service', title: 'MongoDB', group: 'Сайты' },
  { unit: 'pulsdev-api.service', title: 'pulsdev-api', group: 'Сайты' },
  { unit: 'alert_monitor.service', title: 'Air Alert Monitor', group: 'Автоматизация' },
  { unit: 'triggerhappy.service', title: 'triggerhappy (ИК-пульт)', group: 'Автоматизация' },
  { unit: 'cron.service', title: 'cron', group: 'Автоматизация' },
  { unit: 'ssh.service', title: 'SSH', group: 'Безопасность' },
  { unit: 'fail2ban.service', title: 'fail2ban (служба)', group: 'Безопасность' },
  { unit: 'docker.service', title: 'Docker', group: 'Docker' },
  { unit: 'smbd.service', title: 'Samba', group: 'Файлы' },
  { unit: 'xrdp.service', title: 'xrdp', group: 'Доступ' },
  { unit: 'wg-quick@wg0.service', title: 'WireGuard', group: 'Доступ' },
  { unit: 'thermal-watchdog.service', title: 'thermal-watchdog', group: 'Система' },
  { unit: 'mbpfan.service', title: 'mbpfan', group: 'Система' },
  { unit: 'smartmontools.service', title: 'smartmontools', group: 'Диски' },
]

const ROTATED = /\.(\d+|gz|xz|bz2|zst|old)$|-\d{8}$/

async function discoverVarLog(): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string, depth: number) => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory() && depth < 2 && e.name !== 'journal' && e.name !== 'private') await walk(p, depth + 1)
      else if (e.isFile() && !ROTATED.test(e.name) && /(\.log|^syslog|^messages)$/.test(e.name)) out.push(p)
    }
  }
  await walk('/var/log', 0)
  return out
}

export async function listSources(): Promise<LogSource[]> {
  const sources: LogSource[] = JOURNAL_UNITS.map((u) => ({ id: `journal:${u.unit}`, title: u.title, kind: 'journal', group: u.group }))
  try {
    for (const c of await listContainers(false)) sources.push({ id: `container:${c.name}`, title: c.name, kind: 'container', group: 'Docker' })
  } catch {
    /* прокси недоступен — без контейнеров */
  }
  const known = new Set(KNOWN_FILES.map((f) => f.path))
  const files = [...KNOWN_FILES, ...(await discoverVarLog()).filter((p) => !known.has(p)).map((p) => ({ path: p, title: path.relative('/var/log', p), group: 'Прочие логи' }))]
  for (const f of files) {
    const s = await stat(f.path).catch(() => null)
    if (!s) continue
    const readable = await open(f.path, 'r').then((h) => (h.close(), true)).catch(() => false)
    sources.push({ id: `file:${f.path}`, title: f.title, kind: 'file', group: f.group, path: f.path, size: s.size, readable })
  }
  return sources
}

// Последние N строк файла — читаем с конца, не загружая весь файл
async function tailFile(file: string, lines: number, maxBytes = 8 * 1024 * 1024): Promise<string[]> {
  const fh = await open(file, 'r')
  try {
    const { size } = await fh.stat()
    const chunk = 64 * 1024
    let pos = size
    let buf = Buffer.alloc(0)
    let count = 0
    while (pos > 0 && count <= lines && size - pos < maxBytes) {
      const len = Math.min(chunk, pos)
      pos -= len
      const part = Buffer.alloc(len)
      await fh.read(part, 0, len, pos)
      buf = Buffer.concat([part, buf])
      count = buf.toString('utf8').split('\n').length - 1
    }
    const all = buf.toString('utf8').split('\n')
    if (all[all.length - 1] === '') all.pop()
    return all.slice(-lines)
  } finally {
    await fh.close()
  }
}

function detectLevel(text: string): LogLevel {
  if (/\b(emerg|alert|crit(ical)?|fatal|error|err|failed|failure|ошибк|✗)\b/i.test(text)) return 'error'
  if (/\b(warn(ing)?|block|ban)\b|⚠/i.test(text)) return 'warning'
  if (/\bdebug\b/i.test(text)) return 'debug'
  return 'info'
}

// Строки pino (логи Node-служб, в т.ч. самой панели): {"level":30,...,"msg":"..."}
function prettifyPino(line: LogLine): LogLine {
  if (!line.text.startsWith('{"level":')) return line
  try {
    const { level, time, pid, hostname, msg, reqId, ...rest } = JSON.parse(line.text)
    void time, void pid, void hostname, void reqId
    const extra = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : ''
    const lvl: LogLevel = level >= 50 ? 'error' : level >= 40 ? 'warning' : level >= 30 ? 'info' : 'debug'
    return { ts: line.ts, level: lvl, text: `${msg ?? ''}${extra}` }
  } catch {
    return line
  }
}

const PRIORITY: LogLevel[] = ['error', 'error', 'error', 'error', 'warning', 'info', 'info', 'debug']
const LEVEL_RANK: Record<LogLevel, number> = { error: 0, warning: 1, info: 2, debug: 3 }

export async function readLog(sourceId: string, opts: { lines: number; level?: LogLevel; q?: string }) {
  const sources = await listSources()
  let src = sources.find((s) => s.id === sourceId)
  // Журнал любой загруженной службы (ссылка «логи» из таблицы служб)
  if (!src && /^journal:[\w@.:-]+\.(service|timer|socket)$/.test(sourceId)) {
    src = { id: sourceId, title: sourceId.slice(8), kind: 'journal', group: 'Службы' }
  }
  if (!src) throw Object.assign(new Error('неизвестный источник лога'), { statusCode: 404 })
  const lines = Math.min(Math.max(opts.lines, 10), 5000)
  let out: LogLine[]

  if (src.kind === 'container') {
    const q = opts.q?.toLowerCase()
    const raw = await containerLogs(sourceId.slice('container:'.length), opts.level || opts.q ? lines * 10 : lines)
    out = raw
      .map((l) => {
        const lvl = detectLevel(l.text)
        return { ts: l.ts, level: l.stream === 'stderr' && lvl === 'info' ? ('warning' as LogLevel) : lvl, text: l.text }
      })
      .filter((l) => (!opts.level || LEVEL_RANK[l.level] <= LEVEL_RANK[opts.level]) && (!q || l.text.toLowerCase().includes(q)))
      .slice(-lines)
  } else if (src.kind === 'journal') {
    const unit = sourceId.slice('journal:'.length)
    const args = ['-u', unit, '-n', String(lines), '-o', 'json', '--output-fields=MESSAGE,PRIORITY,__REALTIME_TIMESTAMP', '--no-pager']
    if (opts.level) args.push('-p', { error: 'err', warning: 'warning', info: 'info', debug: 'debug' }[opts.level])
    if (opts.q) args.push('--grep', opts.q, '--case-sensitive=false')
    const text = await run('/usr/bin/journalctl', args, { timeoutMs: 20_000, maxBuffer: 32 * 1024 * 1024 }).catch((e) => {
      // journalctl --grep без совпадений выходит с кодом 1
      if (opts.q && e.code === 1) return ''
      throw e
    })
    out = text
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const j = JSON.parse(l)
        const msg = Array.isArray(j.MESSAGE) ? Buffer.from(j.MESSAGE).toString('utf8') : String(j.MESSAGE ?? '')
        const line: LogLine = { ts: Math.floor(Number(j.__REALTIME_TIMESTAMP) / 1000), level: PRIORITY[Number(j.PRIORITY ?? 6)] ?? 'info', text: msg }
        return prettifyPino(line)
      })
  } else {
    if (!src.readable) throw Object.assign(new Error('нет доступа к файлу лога'), { statusCode: 403 })
    // С фильтром берём больше строк, чтобы после фильтрации что-то осталось
    const raw = await tailFile(src.path!, opts.level || opts.q ? lines * 10 : lines)
    const q = opts.q?.toLowerCase()
    out = raw
      .map((text) => ({ ts: null, level: detectLevel(text), text }))
      .filter((l) => (!opts.level || LEVEL_RANK[l.level] <= LEVEL_RANK[opts.level]) && (!q || l.text.toLowerCase().includes(q)))
      .slice(-lines)
  }
  return { source: src, lines: out }
}
