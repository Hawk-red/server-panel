import { readFile } from 'node:fs/promises'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import { ExecError, run } from '../exec.js'
import { getSetting, setSetting } from '../settings.js'

const REPO = '/opt/server-panel'
const STATUS_FILE = `${REPO}/.autopush-status.json`
const JOB_FILE = `${REPO}/data/git-job.json`
const WRAPPER = '/usr/local/sbin/server-panel-git'
const HASH = /^[0-9a-f]{40}$/
// Коммиты, которые меняют права sudo или саму утилиту, автоматически не откатываются (см. server-panel-git)
const PROTECTED = /^deploy\/(sudoers-server-panel|server-panel-git)$/m
const AUDITED_KEY = 'git.job.audited'
const FINAL = ['ok', 'conflict', 'failed', 'error']

// Репозиторий принадлежит hawk, а служба работает от panel — разрешаем именно этот каталог; только чтение
const git = (args: string[], timeoutMs = 10_000) =>
  run('/usr/bin/git', ['-c', `safe.directory=${REPO}`, '-C', REPO, '--no-optional-locks', ...args], { timeoutMs })

const SEP = '\x1f'
const END = '\x1e'

type Commit = { hash: string; ts: number; author: string; subject: string; body: string }
type History = {
  commits: Commit[] // новые первыми
  revertOf: Map<string, string> // revert-коммит → коммит, который он отменяет
  active: Map<string, boolean> // коммит → действует ли его изменение сейчас
  unpushed: Set<string> | null
}

// Полная история: кто что отменяет и что сейчас действует. Revert-коммит отменяет цель; revert самого revert возвращает её.
async function loadHistory(): Promise<History> {
  const [raw, unpushedRaw] = await Promise.all([
    git(['log', `--format=%H${SEP}%at${SEP}%an${SEP}%B${END}`]),
    git(['rev-list', 'origin/main..HEAD']).catch(() => null),
  ])
  const commits: Commit[] = []
  for (const rec of raw.split(END)) {
    const parts = rec.replace(/^\n/, '').split(SEP)
    if (parts.length < 4 || !HASH.test(parts[0])) continue
    const [hash, at, author, ...rest] = parts
    const body = rest.join(SEP).trim()
    commits.push({ hash, ts: Number(at) * 1000, author, subject: body.split('\n')[0].trim(), body })
  }
  const revertOf = new Map<string, string>()
  const children = new Map<string, string[]>()
  for (const c of commits) {
    const m = c.body.match(/This reverts commit ([0-9a-f]{40})/)
    if (c.subject.startsWith('Revert "') && m) {
      revertOf.set(c.hash, m[1])
      children.set(m[1], [...(children.get(m[1]) ?? []), c.hash])
    }
  }
  const active = new Map<string, boolean>()
  const isActive = (h: string): boolean => {
    const known = active.get(h)
    if (known !== undefined) return known
    active.set(h, true) // защита от цикла
    const res = !(children.get(h) ?? []).some((r) => isActive(r))
    active.set(h, res)
    return res
  }
  for (const c of commits) isActive(c.hash)
  const unpushed = unpushedRaw === null ? null : new Set(unpushedRaw.split('\n').filter(Boolean))
  return { commits, revertOf, active, unpushed }
}

// Затрагивает ли коммит защищённые файлы (sudoers и утилита)
const touchesProtected = (hash: string) => git(['show', '--name-only', '--format=', hash]).then((o) => PROTECTED.test(o)).catch(() => true)

// Последняя активная правка, которую можно откатить кнопкой (не revert-коммит)
function lastRevertable(h: History): Commit | null {
  return h.commits.find((c) => !h.revertOf.has(c.hash) && h.active.get(c.hash)) ?? null
}

async function readJob() {
  try {
    return JSON.parse(await readFile(JOB_FILE, 'utf8')) as { id: string; action: string; target: string; status: string; message: string; log: string[]; ts: number }
  } catch {
    return { id: '', action: '', target: '', status: 'idle', message: '', log: [], ts: 0 }
  }
}

// Одна задача за раз: если предыдущая ещё идёт — новую не ставим
async function queueAction(req: FastifyRequest, action: 'revert' | 'restore' | 'revert-last', hash: string, subject: string, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  const job = await readJob()
  if (job.status === 'queued' || job.status === 'running') return reply.code(409).send({ message: 'уже выполняется другая правка, дождитесь её окончания' })
  try {
    const out = await run('/usr/bin/sudo', ['-n', WRAPPER, action, hash], { timeoutMs: 15_000 })
    audit({ ip: req.clientIp, user: 'admin', action: `git.${action}`, target: hash.slice(0, 7), details: { subject }, result: 'ok' })
    return reply.code(202).send({ id: out.trim() })
  } catch (e) {
    const msg = e instanceof ExecError ? e.stderr.trim() || 'утилита не выполнила действие' : 'утилита недоступна'
    audit({ ip: req.clientIp, user: 'admin', action: `git.${action}`, target: hash.slice(0, 7), details: { subject, error: msg }, result: 'error' })
    return reply.code(409).send({ message: msg })
  }
}

export async function panelChangesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  // Список коммитов: дата, автор, заголовок, хэш; откат/возврат-статус; защищённые коммиты помечены
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/api/panel-changes', async (req, reply) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200)
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)
    try {
      const h = await loadHistory()
      const page = h.commits.slice(offset, offset + limit)
      const protectedFlags = await Promise.all(page.map((c) => touchesProtected(c.hash)))
      const rows = page.map((c, i) => {
        const revertOf = h.revertOf.get(c.hash) ?? null
        const revertedBy = h.commits.find((r) => h.revertOf.get(r.hash) === c.hash && h.active.get(r.hash))?.hash ?? null
        return {
          hash: c.hash,
          ts: c.ts,
          author: c.author,
          subject: c.subject,
          body: c.body.split('\n').slice(1).join('\n').trim(),
          pushed: h.unpushed !== null && !h.unpushed.has(c.hash),
          kind: revertOf ? 'revert' : 'commit',
          revertOf,
          active: h.active.get(c.hash) ?? true,
          revertedBy: revertedBy && !revertOf ? revertedBy : null,
          protected: protectedFlags[i],
        }
      })
      return { total: h.commits.length, rows }
    } catch {
      return reply.code(500).send({ message: 'не удалось прочитать историю git' })
    }
  })

  // Файлы коммита (по клику): статус, путь, добавлено/удалено
  app.get<{ Params: { hash: string } }>('/api/panel-changes/:hash', async (req, reply) => {
    const { hash } = req.params
    if (!/^[0-9a-f]{7,40}$/.test(hash)) return reply.code(400).send({ message: 'неверный хэш' })
    try {
      const [names, nums] = await Promise.all([
        git(['show', '--format=', '--name-status', '-M', hash]),
        git(['show', '--format=', '--numstat', '-M', hash]),
      ])
      const stat = nums
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split('\t'))
      const files = names
        .split('\n')
        .filter(Boolean)
        .map((l, i) => {
          const p = l.split('\t')
          const [add, del] = stat[i] ?? []
          return { status: p[0][0], path: p[p.length - 1], from: p.length > 2 ? p[1] : null, added: add === '-' ? null : Number(add), deleted: del === '-' ? null : Number(del) }
        })
      return { files }
    } catch {
      return reply.code(404).send({ message: 'коммит не найден' })
    }
  })

  // Статус резервной копии: последний push (по времени обновления origin/main), неотправленные, итог последнего запуска cron
  app.get('/api/panel-changes/backup-status', async () => {
    const [remote, ahead, lastPush, head] = await Promise.all([
      git(['remote', 'get-url', 'origin']).catch(() => null),
      git(['rev-list', '--count', 'origin/main..HEAD']).catch(() => null),
      git(['reflog', 'show', '--date=unix', '-n1', '--format=%gd', 'origin/main']).catch(() => null),
      git(['status', '--porcelain']).catch(() => null),
    ])
    const m = lastPush?.match(/@\{(\d+)\}/)
    let auto: { ts: number; result: string; count: number; message: string } | null = null
    try {
      auto = JSON.parse(await readFile(STATUS_FILE, 'utf8'))
    } catch {
      /* cron ещё не запускался */
    }
    return {
      remote: remote?.trim().replace(/^git@[^:]+:/, '') ?? null,
      unpushed: ahead === null ? null : Number(ahead),
      lastPushTs: m ? Number(m[1]) * 1000 : null,
      uncommitted: head === null ? null : head.split('\n').filter(Boolean).length,
      auto,
    }
  })

  // Состояние последней задачи (откат/возврат/пересборка). Итог записываем в журнал один раз.
  app.get('/api/panel-changes/job', async () => {
    const job = await readJob()
    if (FINAL.includes(job.status) && getSetting<string>(AUDITED_KEY, '') !== job.id) {
      setSetting(AUDITED_KEY, job.id)
      audit({ ip: '-', user: 'system', action: 'git.job', target: job.target?.slice(0, 7) || null, details: { id: job.id, action: job.action, status: job.status, message: job.message }, result: job.status === 'ok' ? 'ok' : 'error' })
    }
    return job
  })

  // Что откатит кнопка «Откатить последнюю правку» (для подтверждения в сайдбаре)
  app.get('/api/panel-changes/revert-candidate', async () => {
    const c = lastRevertable(await loadHistory())
    if (!c) return null
    return { hash: c.hash, subject: c.subject, protected: await touchesProtected(c.hash) }
  })

  app.post<{ Body: { hash: string } }>('/api/panel-changes/revert', async (req, reply) => {
    const hash = req.body?.hash
    if (!HASH.test(hash ?? '')) return reply.code(400).send({ message: 'неверный хэш' })
    const h = await loadHistory()
    const c = h.commits.find((x) => x.hash === hash)
    if (!c) return reply.code(404).send({ message: 'коммит не найден' })
    if (h.revertOf.has(hash)) return reply.code(400).send({ message: 'это revert-коммит: вернуть его можно у исходного коммита' })
    if (!h.active.get(hash)) return reply.code(409).send({ message: 'коммит уже откачен' })
    return queueAction(req, 'revert', hash, c.subject, reply)
  })

  app.post<{ Body: { hash: string } }>('/api/panel-changes/restore', async (req, reply) => {
    const hash = req.body?.hash
    if (!HASH.test(hash ?? '')) return reply.code(400).send({ message: 'неверный хэш' })
    const h = await loadHistory()
    const c = h.commits.find((x) => x.hash === hash)
    if (!c) return reply.code(404).send({ message: 'коммит не найден' })
    if (h.active.get(hash)) return reply.code(409).send({ message: 'коммит не откачен, возвращать нечего' })
    return queueAction(req, 'restore', hash, c.subject, reply)
  })

  // Откат последней правки: хэш должен совпадать с тем, что показано в подтверждении (защита от гонки)
  app.post<{ Body: { hash: string } }>('/api/panel-changes/revert-last', async (req, reply) => {
    const hash = req.body?.hash
    if (!HASH.test(hash ?? '')) return reply.code(400).send({ message: 'неверный хэш' })
    const c = lastRevertable(await loadHistory())
    if (!c || c.hash !== hash) return reply.code(409).send({ message: 'последняя правка изменилась — обновите страницу' })
    return queueAction(req, 'revert-last', hash, c.subject, reply)
  })
}
