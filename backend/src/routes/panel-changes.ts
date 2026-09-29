import { readFile } from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth.js'
import { run } from '../exec.js'

const REPO = '/opt/server-panel'
const STATUS_FILE = `${REPO}/.autopush-status.json`
// Репозиторий принадлежит hawk, а служба работает от panel — разрешаем именно этот каталог; только чтение
const git = (args: string[], timeoutMs = 10_000) =>
  run('/usr/bin/git', ['-c', `safe.directory=${REPO}`, '-C', REPO, '--no-optional-locks', ...args], { timeoutMs })

const SEP = '\x1f'
const END = '\x1e'

export async function panelChangesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  // Список коммитов: дата, автор, сообщение, хэш; unpushed — коммиты, которых ещё нет в origin/main
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/api/panel-changes', async (req, reply) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200)
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)
    try {
      const [log, total, unpushed] = await Promise.all([
        git(['log', `--skip=${offset}`, `-n${limit}`, `--format=%H${SEP}%at${SEP}%an${SEP}%s${SEP}%b${END}`]),
        git(['rev-list', '--count', 'HEAD']),
        git(['rev-list', 'origin/main..HEAD']).catch(() => null),
      ])
      const pending = new Set((unpushed ?? '').split('\n').filter(Boolean))
      const rows = log
        .split(END)
        .map((s) => s.replace(/^\n/, ''))
        .filter(Boolean)
        .map((rec) => {
          const [hash, at, author, subject, body] = rec.split(SEP)
          return { hash, ts: Number(at) * 1000, author, subject, body: (body ?? '').trim(), pushed: unpushed !== null && !pending.has(hash) }
        })
      return { total: Number(total), rows }
    } catch (e) {
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
}
