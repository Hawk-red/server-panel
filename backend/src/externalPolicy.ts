// Что можно делать снаружи (из интернета через nginx). Решение принимает один хук (externalPolicy) до любых обработчиков:
//  • не-GET запрос снаружи по умолчанию ЗАПРЕЩЁН — разрешены только строки из EXTERNAL_WRITE_ALLOWED;
//  • GET снаружи доступен, кроме чувствительных чтений из INTERNAL_ONLY_READ (журналы, сеть, доступ, настройки);
//  • для любых не-GET запросов проверяется Origin (должен совпадать с Host).
// Внутренних клиентов (isInternal) хук не ограничивает, кроме проверки Origin.
import type { FastifyReply, FastifyRequest } from 'fastify'
import { audit } from './audit.js'
import { isInternal } from './net.js'

export const EXTERNAL_DENIED_TEXT = 'доступно только из домашней сети или через WireGuard'

// Единственные не-GET маршруты, доступные снаружи
export const EXTERNAL_WRITE_ALLOWED = new Set(['POST /api/auth/login', 'POST /api/auth/logout'])

// GET-маршруты (по префиксу), которые отдают внутреннюю информацию: журналы и диагностика (в них бывают адреса, пути, команды),
// список устройств сети, SSH и доступ, cron (команды), история правок, журнал действий, настройки. Снаружи — только панель мониторинга.
export const INTERNAL_ONLY_READ = [
  '/api/security',
  '/api/access',
  '/api/logs',
  '/api/diagnostics',
  '/api/audit',
  '/api/system/cron',
  '/api/panel-changes',
  '/api/notify',
  '/api/settings',
  '/api/network',
  '/api/wireless',
  '/api/sites/jetsetter',
  '/api/system/updates/docker/job', // состояние и журнал задач обновления контейнеров
  '/api/system/updates/docker/qbittorrent', // список торрентов и состояние «остановить и обновить»
  '/api/torrents/panel-stopped', // имена торрентов
  '/api/ai/settings',
]

const pathOf = (url: string) => url.split('?')[0].toLowerCase()
const isRead = (m: string) => m === 'GET' || m === 'HEAD'

export function externalAllowed(method: string, url: string): boolean {
  const m = method.toUpperCase()
  const p = pathOf(url)
  if (isRead(m)) return !INTERNAL_ONLY_READ.some((x) => p === x || p.startsWith(x + '/'))
  return EXTERNAL_WRITE_ALLOWED.has(`${m} ${p}`)
}

// Origin должен совпадать с Host запроса (защита от запросов с чужих сайтов). Нет заголовка — разрешено только внутренним (curl, скрипты).
export function originOk(req: FastifyRequest): boolean {
  const origin = req.headers.origin
  if (!origin) return isInternal(req)
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

const lastAudit = new Map<string, number>()

export async function externalPolicy(req: FastifyRequest, reply: FastifyReply) {
  const write = !isRead(req.method) && req.method !== 'OPTIONS'
  if (!isInternal(req) && !externalAllowed(req.method, req.url)) {
    // в журнал — не чаще раза в минуту на адрес (иначе сканер забьёт журнал)
    const key = `${req.clientIp} ${req.method}`
    if (Date.now() - (lastAudit.get(key) ?? 0) > 60_000) {
      lastAudit.set(key, Date.now())
      audit({ ip: req.clientIp, action: 'external.denied', target: `${req.method} ${pathOf(req.url)}`, details: { where: 'external' }, result: 'denied' })
    }
    return reply.code(403).send({ message: EXTERNAL_DENIED_TEXT })
  }
  if (write && !originOk(req)) {
    audit({ ip: req.clientIp, action: 'origin.denied', target: `${req.method} ${pathOf(req.url)}`, details: { where: isInternal(req) ? 'internal' : 'external' }, result: 'denied' })
    return reply.code(403).send({ message: 'Запрос отклонён: неверный источник (Origin)' })
  }
}
