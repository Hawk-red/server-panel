import type { FastifyInstance } from 'fastify'
import { audit } from '../audit.js'
import { confirmPanelPassword } from '../auth.js'
import { spawn } from 'node:child_process'
import { requireAuth } from '../auth.js'
import { getSnapshot, SAMPLE_INTERVAL } from '../collector/index.js'
import { listDevices, summary as networkSummary } from '../network/scanner.js'
import { summary as torrentSummary } from '../services/qbittorrent.js'
import { listSeriesNames, querySeries, RANGES, type Range } from '../collector/store.js'
import { listCron } from '../system/cron.js'
import { listDisks, refreshAllSmart } from '../system/disks.js'
import { MOUNTABLE, runMountAction, type MountAction } from '../system/mounts.js'
import { getDiskIoHistory, getDiskIoLatest } from '../system/disk-io.js'
import { listSources, readLog, type LogLevel } from '../system/logs.js'
import { run } from '../exec.js'
import { staleBackups, backupsOverview } from '../services/backups.js'
import { listDeadlines } from '../services/deadlines.js'
import { fmtDur, internetStatus, lastPing } from '../services/internet.js'
import { checkDockerNow, DANGEROUS, listUpdates, lockFor, upgradableNames } from '../services/updates.js'
import { getDockerJob, managedInfo, runningDockerJob, startDockerJob, StartError } from '../services/dockerManage.js'
import { getAptJob, jobSlice, startAptJob } from '../services/aptJob.js'
import { ACTIONS, CONTROLLABLE, controlUnit, failedUnits, listAutostart, listServices, type UnitAction } from '../system/units.js'

// Сводка проблем для главной: только то, что реально требует внимания.
// kind + ref позволяют открыть по проблеме диагностику (лог, статус, переход в раздел).
type Problem = { level: 'error' | 'warning'; text: string; kind: 'unit' | 'disk' | 'smart' | 'temp' | 'devices' | 'source' | 'internet' | 'backup' | 'deadline' | 'update'; ref: string; link: string }

async function collectProblems(): Promise<Problem[]> {
  const snap = getSnapshot()
  const problems: Problem[] = []
  const failed = await failedUnits().catch(() => null)
  if (failed === null) problems.push({ level: 'warning', text: 'Не удалось получить список упавших служб', kind: 'source', ref: 'systemd', link: '/system?tab=services' })
  else for (const u of failed) problems.push({ level: 'error', text: `Служба ${u} упала`, kind: 'unit', ref: u, link: `/system?tab=services` })
  for (const d of snap?.disks ?? []) {
    const link = '/system?tab=disks'
    if (d.state === 'missing') problems.push({ level: 'error', text: `Диск ${d.mount} из fstab не подключён`, kind: 'disk', ref: d.mount ?? d.device, link })
    // Шкала этапа 8: > 85% — красная зона (ошибка); 70–85% — только жёлтый цвет, не проблема
    else if (d.percent !== null && d.percent > 85) problems.push({ level: 'error', text: `Диск ${d.mount} заполнен на ${Math.round(d.percent)}%`, kind: 'disk', ref: d.mount ?? d.device, link })
    if (d.smart?.status === 'failing') problems.push({ level: 'error', text: `SMART: диск ${d.disk} (${d.model ?? '?'}) неисправен`, kind: 'smart', ref: d.disk, link })
    if (d.smart?.temperature != null && d.smart.temperature > 55)
      problems.push({ level: 'warning', text: `Диск ${d.disk} нагрелся до ${d.smart.temperature} °C`, kind: 'smart', ref: d.disk, link })
  }
  const t = snap?.temperature?.cpu
  if (t != null && t > 85) problems.push({ level: 'error', text: `Перегрев CPU: ${Math.round(t)} °C`, kind: 'temp', ref: 'cpu', link: '/system?tab=resources' })
  else if (t != null && t >= 70) problems.push({ level: 'warning', text: `CPU горячий: ${Math.round(t)} °C`, kind: 'temp', ref: 'cpu', link: '/system?tab=resources' })
  const net = networkSummary()
  if (net.unknown > 0)
    problems.push({ level: 'warning', text: `В сети ${net.unknown} неизвестн. устройств(а) — подпишите их в «Сеть и устройства»`, kind: 'devices', ref: 'unknown', link: '/network' })
  const inet = internetStatus()
  if (inet.downSince && Date.now() - inet.downSince > 120_000)
    problems.push({ level: 'error', text: `Нет интернета уже ${fmtDur(Math.round((Date.now() - inet.downSince) / 1000))}`, kind: 'internet', ref: 'internet', link: '/internet' })
  for (const b of await staleBackups().catch(() => []))
    problems.push({
      level: 'warning',
      text: b.status === 'missing' ? `Нет копий: ${b.title}` : `Копия устарела: ${b.title} (последней ${Math.round((b.ageSec ?? 0) / 3600)} ч назад, порог ${b.maxAgeH} ч)`,
      kind: 'backup',
      ref: b.id,
      link: '/backups',
    })
  for (const d of await listDeadlines().catch(() => [])) {
    if (d.daysLeft === null || d.daysLeft > 14) continue
    problems.push({
      level: d.daysLeft <= 3 ? 'error' : 'warning',
      text: d.daysLeft < 0 ? `${d.title}: срок истёк ${-d.daysLeft} дн. назад` : `${d.title}: осталось ${d.daysLeft} дн.`,
      kind: 'deadline',
      ref: d.id,
      link: '/',
    })
  }
  for (const [src, e] of Object.entries(snap?.errors ?? {})) {
    problems.push({ level: 'warning', text: `Нет данных от источника «${src}»: ${e!.message}`, kind: 'source', ref: src, link: SOURCE_LINK[src] ?? '/system' })
  }
  const upd = await listUpdates().catch(() => null)
  if (upd?.apt.rebootRequired.required)
    problems.push({ level: 'warning', text: 'Требуется перезагрузка — обновлено ядро или системная библиотека', kind: 'update', ref: 'reboot', link: '/updates' })
  if (upd && upd.apt.securityCount > 0)
    problems.push({ level: 'warning', text: `Доступно ${upd.apt.securityCount} обновлени${upd.apt.securityCount === 1 ? 'е' : 'й'} безопасности`, kind: 'update', ref: 'security', link: '/updates' })
  return problems
}

const SOURCE_LINK: Record<string, string> = {
  qbittorrent: '/torrents',
  adguard: '/adguard',
  network: '/network',
  smart: '/system?tab=disks',
  disks: '/system?tab=disks',
  temperature: '/system?tab=resources',
}

// Диагностика по проблеме: статус + последние строки лога + готовый текст для чата с Claude
async function diagnose(kind: string, ref: string) {
  const now = new Date()
  let status = ''
  let logSource: string | null = null
  let lines: string[] = []
  const tail = async (id: string, n: number) =>
    (await readLog(id, { lines: n }).catch(() => ({ lines: [] as { ts: number | null; text: string }[] }))).lines.map(
      (l) => `${l.ts ? new Date(l.ts).toLocaleString('ru-RU') + '  ' : ''}${l.text}`
    )
  if (kind === 'unit') {
    if (!/^[\w@.:-]+$/.test(ref)) throw Object.assign(new Error('некорректное имя юнита'), { statusCode: 400 })
    status = await run('/usr/bin/systemctl', ['status', ref, '--no-pager', '-n', '0']).catch((e) => (e.stdout as string) || (e.message as string))
    logSource = `journal:${ref}`
    lines = await tail(logSource, 100)
  } else if (kind === 'disk' || kind === 'smart') {
    const d = (getSnapshot()?.disks ?? []).find((x) => x.mount === ref || x.disk === ref || x.device === ref)
    status = d
      ? [
          `Устройство: ${d.device} (${d.model ?? 'модель неизвестна'}), ФС ${d.fstype ?? '?'}, точка ${d.mount ?? '—'}`,
          `Состояние: ${d.state}; занято ${d.percent ?? '?'}%`,
          `SMART: ${d.smart ? `${d.smart.status}${d.smart.temperature != null ? `, ${d.smart.temperature} °C` : ''}${d.smart.error ? `, ${d.smart.error}` : ''}` : 'нет данных'}`,
        ].join('\n')
      : `Диск ${ref}: нет данных в снимке`
    status += '\n\n' + (await run('/usr/bin/df', ['-h', '--output=source,fstype,size,used,avail,pcent,target']).catch(() => ''))
    logSource = 'file:/home/hawk/disk-monitor.log'
    lines = await tail(logSource, 100)
  } else if (kind === 'temp') {
    const s = getSnapshot()
    status = `CPU ${s?.temperature?.cpu ?? '?'} °C (ядра: ${s?.temperature?.cores.join(', ') ?? '?'}), вентилятор ${s?.fan?.rpm ?? '?'} об/мин, load ${s?.load ? `${s.load.l1} / ${s.load.l5} / ${s.load.l15}` : '?'}`
    logSource = 'journal:thermal-watchdog.service'
    lines = await tail(logSource, 100)
  } else if (kind === 'devices') {
    const devs = listDevices().filter((d) => !d.known)
    status = devs.map((d) => `${d.ip}  ${d.mac}  ${d.vendor ?? (d.randomMac ? 'случайный MAC' : '?')}  ${d.hostname ?? ''}`).join('\n')
  } else if (kind === 'internet') {
    const i = internetStatus()
    const p = lastPing()
    const t = (x: number) => new Date(x).toLocaleString('ru-RU')
    status = [
      p ? `Последний замер ${t(p.ts)}: ${i.targets.main} — ${p.main === null ? 'нет ответа' : `${p.main} мс`}; ${i.targets.second} — ${p.second === null ? 'нет ответа' : `${p.second} мс`}` : 'замеров ещё не было',
      i.downSince ? `Интернета нет с ${t(i.downSince)}` : 'Сейчас связь есть',
      `Внешний IP: ${i.ip?.ip ?? 'неизвестен'}`,
      '',
      'Последние обрывы:',
      ...(i.outages.slice(0, 5).map((o) => `  ${t(o.from)} — ${t(o.to)} (${fmtDur(o.sec)})`) || []),
    ].join('\n')
  } else if (kind === 'backup') {
    const b = (await backupsOverview()).find((x) => x.id === ref)
    status = b
      ? [`${b.title} (${b.path})`, `Состояние: ${b.status}${b.note ? ` — ${b.note}` : ''}`, `Последняя: ${b.latest ? `${b.latest.name}, ${new Date(b.latest.mtime).toLocaleString('ru-RU')}` : 'нет'}`, `Порог возраста: ${b.maxAgeH ?? '—'} ч`, `Копий: ${b.count ?? '?'}`].join('\n')
      : `Копия ${ref}: нет данных`
    if (ref === 'sync-jetsetter') {
      logSource = 'file:/var/log/sync-jetsetter.log'
      lines = await tail(logSource, 100)
    }
  } else if (kind === 'deadline') {
    const d = (await listDeadlines()).find((x) => x.id === ref)
    status = d ? [d.title, `Срок: ${d.expires ? new Date(d.expires).toLocaleDateString('ru-RU') : 'неизвестен'}`, `Осталось дней: ${d.daysLeft ?? '?'}`, d.note ?? '', d.error ?? ''].filter(Boolean).join('\n') : `Срок ${ref}: нет данных`
  } else if (kind === 'update') {
    const u = await listUpdates()
    status =
      ref === 'reboot'
        ? `Требуется перезагрузка.\nПричина: ${u.apt.rebootRequired.pkgs.join(', ') || 'неизвестна'}`
        : [`Обновлений безопасности: ${u.apt.securityCount}`, ...u.apt.packages.filter((p) => p.security).map((p) => `  ${p.name}: ${p.from} → ${p.to}`)].join('\n')
  } else {
    const e = getSnapshot()?.errors[ref as keyof NonNullable<ReturnType<typeof getSnapshot>>['errors']]
    status = e ? `Источник «${ref}» недоступен с ${new Date(e.since).toLocaleString('ru-RU')}: ${e.message}` : `Источник «${ref}»: ошибок сейчас нет`
    logSource = 'journal:server-panel.service'
    lines = (await tail(logSource, 300)).filter((l) => l.includes(ref)).slice(-100)
  }
  const copy = [
    `Проблема на сервере Mac Mini (панель, ${now.toLocaleString('ru-RU')})`,
    `Тип: ${kind}, объект: ${ref}`,
    '',
    '--- Статус ---',
    status.trim() || '(нет)',
    '',
    `--- Последние ${Math.min(50, lines.length)} строк лога${logSource ? ` (${logSource})` : ''} ---`,
    ...lines.slice(-50),
  ].join('\n')
  return { kind, ref, status, logSource, lines, copy }
}

export async function systemRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  app.get<{ Querystring: { kind?: string; ref?: string } }>('/api/diagnostics', async (req, reply) => {
    const { kind, ref } = req.query
    if (!kind || !ref || !['unit', 'disk', 'smart', 'temp', 'devices', 'source', 'internet', 'backup', 'deadline', 'update'].includes(kind)) return reply.code(400).send({ message: 'нужны kind и ref' })
    try {
      return await diagnose(kind, ref)
    } catch (e) {
      const err = e as Error & { statusCode?: number }
      return reply.code(err.statusCode ?? 500).send({ message: err.message })
    }
  })

  app.get('/api/system/snapshot', async () => ({ interval: SAMPLE_INTERVAL, snapshot: getSnapshot() }))

  app.get('/api/overview', async () => {
    const services = await listServices().catch(() => null)
    const main = services?.filter((s) => !s.background)
    return {
      snapshot: getSnapshot(),
      services: main
        ? {
            running: main.filter((s) => s.active === 'active').length,
            failed: main.filter((s) => s.active === 'failed').length,
            total: main.length,
          }
        : null,
      containers: await listAutostart()
        .then((a) => (a.containers ? { running: a.containers.filter((c) => c.state === 'running').length, total: a.containers.length } : null))
        .catch(() => null),
      devices: networkSummary(),
      torrents: await torrentSummary()
        .then((t) => ({ active: t.active.length, downloading: t.counts.downloading, seeding: t.counts.seeding }))
        .catch(() => null),
      problems: await collectProblems(),
    }
  })

  app.get<{ Querystring: { series?: string; range?: string } }>('/api/metrics', async (req, reply) => {
    const range = (req.query.range ?? 'hour') as Range
    if (!RANGES.includes(range)) return reply.code(400).send({ message: 'неизвестный диапазон' })
    const names = (req.query.series ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30)
    return querySeries(names, range)
  })
  app.get('/api/metrics/names', async () => listSeriesNames())

  // Перезагрузка сервера: только по повторному вводу пароля панели; одна точная команда через sudo
  app.post<{ Body: { password: string } }>(
    '/api/system/reboot',
    {
      schema: {
        body: { type: 'object', required: ['password'], properties: { password: { type: 'string', minLength: 1, maxLength: 512 } } },
      },
    },
    async (req, reply) => {
      const check = await confirmPanelPassword(req.clientIp, req.body.password)
      if (!check.ok) {
        audit({ ip: req.clientIp, user: 'admin', action: 'system.reboot', result: 'denied', details: { reason: check.status === 401 ? 'bad-password' : 'rate-limit' } })
        return reply.code(check.status).send({ message: check.message })
      }
      audit({ ip: req.clientIp, user: 'admin', action: 'system.reboot', result: 'ok', details: { note: 'перезагрузка запущена' } })
      // Ответ уходит клиенту до перезагрузки: команда стартует с небольшой задержкой
      setTimeout(() => {
        const child = spawn('/usr/bin/sudo', ['-n', '/usr/sbin/reboot'], { stdio: 'ignore', detached: true })
        child.on('error', () => undefined)
        child.unref()
      }, 2000)
      return reply.code(202).send({ ok: true, in: 2 })
    }
  )

  // Перезапуск самой панели: лёгкое действие (пароль не нужен, подтверждение — в интерфейсе). Одна точная команда через sudo.
  // Ответ уходит до остановки службы: команда стартует с задержкой. Панель вернётся сама, страница ждёт её.
  app.post('/api/system/panel/restart', async (req, reply) => {
    audit({ ip: req.clientIp, user: 'admin', action: 'system.panel-restart', result: 'ok', details: { note: 'перезапуск службы server-panel' } })
    setTimeout(() => {
      const child = spawn('/usr/bin/sudo', ['-n', '/usr/bin/systemctl', 'restart', 'server-panel.service'], { stdio: 'ignore', detached: true })
      child.on('error', () => undefined)
      child.unref()
    }, 1500)
    return reply.code(202).send({ ok: true, in: 1.5 })
  })

  app.get('/api/system/updates', async () => listUpdates())
  // «Проверить сейчас» для Docker-образов: опрос реестров (только чтение), не чаще раза в 15 секунд
  app.post('/api/system/updates/docker/check', async (_req, reply) => {
    const ran = await checkDockerNow()
    if (!ran) return reply.code(429).send({ message: 'проверка уже идёт или была только что — подождите несколько секунд' })
    return listUpdates()
  })

  // Обновление/откат Docker-контейнера через root-помощника. Только контейнеры из белого списка помощника; для опасных
  // (portainer, adguardhome, qbittorrent, docker-socket-proxy) — повторный ввод пароля панели. Кнопки «обновить все» нет.
  for (const action of ['update', 'rollback'] as const) {
    app.post<{ Params: { name: string }; Body: { password?: string } }>(
      `/api/system/updates/docker/:name/${action}`,
      {
        schema: {
          params: { type: 'object', required: ['name'], properties: { name: { type: 'string', pattern: '^[a-z0-9][a-z0-9_.-]{0,40}$' } } },
          body: { type: 'object', properties: { password: { type: 'string', maxLength: 512 } } },
        },
      },
      async (req, reply) => {
        const { name } = req.params
        const audited = (result: 'denied' | 'error', reason: string) => audit({ ip: req.clientIp, user: 'admin', action: `docker.${action}.start`, target: name, result, details: { reason } })
        const info = await managedInfo(name)
        if (!info.managed) return reply.code(409).send({ message: 'контейнер не подключён к обновлению из панели' })
        if (info.danger || DANGEROUS.has(name)) {
          if (!req.body?.password) return reply.code(400).send({ message: 'нужен пароль панели' })
          const check = await confirmPanelPassword(req.clientIp, req.body.password)
          if (!check.ok) {
            audited('denied', check.status === 401 ? 'bad-password' : 'rate-limit')
            return reply.code(check.status).send({ message: check.message })
          }
        }
        if (action === 'rollback' && !info.rollback) return reply.code(409).send({ message: 'нет сохранённого образа для отката' })
        const busy = await runningDockerJob()
        if (busy) return reply.code(409).send({ message: `уже выполняется задача для ${busy.container}` })
        if (action === 'update') {
          const lock = await lockFor(name)
          if (lock) {
            audited('denied', `lock: ${lock}`)
            return reply.code(409).send({ message: `обновление заблокировано: ${lock}` })
          }
        }
        try {
          const id = await startDockerJob(action, name, req.clientIp)
          return reply.code(202).send({ id })
        } catch (e) {
          const status = e instanceof StartError ? e.statusCode : 500
          return reply.code(status).send({ message: (e as Error).message })
        }
      }
    )
  }

  // Состояние задачи обновления контейнера (последняя или по id) + новые строки журнала с offset
  app.get<{ Querystring: { id?: string; offset?: string } }>('/api/system/updates/docker/job', async (req, reply) => {
    const job = await getDockerJob(req.query.id ?? null, Math.max(0, Number(req.query.offset ?? 0) || 0))
    if (!job) return reply.code(404).send({ message: 'задач пока не было' })
    return job
  })

  // Установка обновлений apt: только уже установленные пакеты из текущего списка (--only-upgrade) или dist-upgrade
  app.post<{ Body: { mode: 'selected' | 'all'; packages?: string[] } }>(
    '/api/system/updates/apt/upgrade',
    {
      schema: {
        body: {
          type: 'object',
          required: ['mode'],
          properties: {
            mode: { type: 'string', enum: ['selected', 'all'] },
            packages: { type: 'array', maxItems: 300, items: { type: 'string', pattern: '^[a-z0-9][a-z0-9+.-]+$', maxLength: 100 } },
          },
        },
      },
    },
    async (req, reply) => {
      const { mode } = req.body
      let packages: string[] = []
      if (mode === 'selected') {
        packages = [...new Set(req.body.packages ?? [])]
        if (packages.length === 0) return reply.code(400).send({ message: 'не выбрано ни одного пакета' })
        const allowed = upgradableNames()
        const unknown = packages.filter((p) => !allowed.has(p))
        if (unknown.length) return reply.code(409).send({ message: `пакеты уже не в списке обновлений (обновите список): ${unknown.join(', ')}` })
      }
      try {
        const job = startAptJob(mode, packages, req.clientIp)
        return { id: job.id, mode, packages, startedAt: job.startedAt }
      } catch (e) {
        return reply.code(409).send({ message: (e as Error).message })
      }
    }
  )

  app.get<{ Querystring: { offset?: string } }>('/api/system/updates/apt/job', async (req, reply) => {
    const job = getAptJob()
    if (!job) return reply.code(404).send({ message: 'задач пока не было' })
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0)
    const { lines, total, truncated } = jobSlice(job, offset)
    return {
      id: job.id,
      mode: job.mode,
      packages: job.packages,
      status: job.status,
      exitCode: job.exitCode,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      lines,
      offset: total,
      truncated,
    }
  })

  app.get('/api/system/disks', async () => listDisks())
  app.get('/api/system/disks/io', async () => getDiskIoLatest())
  app.get('/api/system/disks/io-history', async () => getDiskIoHistory())
  app.post('/api/system/disks/smart-refresh', async (req) => {
    await refreshAllSmart()
    audit({ ip: req.clientIp, user: 'admin', action: 'disks.smart-refresh', result: 'ok' })
    return listDisks()
  })

  // Монтирование съёмного диска: mount — отвалился/не смонтирован; remount — зависшее монтирование
  app.post<{ Body: { mount: string; action: MountAction } }>(
    '/api/system/disks/mount',
    {
      schema: {
        body: {
          type: 'object',
          required: ['mount', 'action'],
          properties: { mount: { type: 'string', enum: [...MOUNTABLE] }, action: { type: 'string', enum: ['mount', 'remount'] } },
        },
      },
    },
    async (req, reply) => {
      const { mount, action } = req.body
      const disk = (await listDisks()).find((d) => d.mount === mount)
      const allowed = action === 'remount' ? disk?.state === 'stale' : disk?.state === 'missing' || disk?.state === 'unmounted'
      if (!allowed) {
        const msg = action === 'remount' ? 'зависшее монтирование не найдено' : `диск уже смонтирован (состояние: ${disk?.state ?? 'нет в списке'})`
        return reply.code(409).send({ message: msg })
      }
      try {
        await runMountAction(mount, action)
        audit({ ip: req.clientIp, user: 'admin', action: `disks.${action}`, target: mount, result: 'ok' })
        return { ok: true }
      } catch (e) {
        const message = (e as Error).message
        audit({ ip: req.clientIp, user: 'admin', action: `disks.${action}`, target: mount, result: 'error', details: { message } })
        return reply.code(500).send({ message })
      }
    }
  )

  app.get('/api/system/services', async () => listServices())
  app.post<{ Params: { unit: string; action: string } }>('/api/system/services/:unit/:action', async (req, reply) => {
    const { unit, action } = req.params
    if (!CONTROLLABLE[unit] || !ACTIONS.includes(action as UnitAction)) {
      audit({ ip: req.clientIp, user: 'admin', action: `service.${action}`, target: unit, result: 'denied' })
      return reply.code(403).send({ message: 'Эта служба или действие не разрешены' })
    }
    try {
      await controlUnit(unit, action as UnitAction)
      audit({ ip: req.clientIp, user: 'admin', action: `service.${action}`, target: unit, result: 'ok' })
      return { ok: true }
    } catch (e) {
      const message = (e as Error).message
      audit({ ip: req.clientIp, user: 'admin', action: `service.${action}`, target: unit, result: 'error', details: { message } })
      return reply.code(500).send({
        message: /password is required|not allowed/i.test(message) ? 'Нет прав: команда не разрешена в sudoers' : message,
      })
    }
  })

  app.get('/api/system/cron', async () => listCron())
  app.get('/api/system/autostart', async () => listAutostart())

  app.get('/api/logs/sources', async () => listSources())
  app.get<{ Querystring: { source: string; lines?: string; level?: string; q?: string } }>('/api/logs', async (req, reply) => {
    const level = req.query.level as LogLevel | undefined
    if (level && !['error', 'warning', 'info', 'debug'].includes(level)) return reply.code(400).send({ message: 'неизвестный уровень' })
    try {
      return await readLog(req.query.source, { lines: Number(req.query.lines ?? 200), level, q: req.query.q?.slice(0, 200) || undefined })
    } catch (e) {
      const err = e as Error & { statusCode?: number }
      return reply.code(err.statusCode ?? 500).send({ message: err.message })
    }
  })
}
