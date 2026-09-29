// Третий бот раздела «Telegram-боты»: бот уведомлений самой панели (Mac Mini).
// Это не отдельный процесс, а встроенный модуль панели (backend/src/notifier.ts): работает внутри службы server-panel,
// отправляет сообщения через Bot API токеном NOTIFY_BOT_TOKEN. Токен наружу не отдаётся.
import { BACKEND_DIR, ENV_FILE, config } from '../config.js'
import { getNotifySettings, inQuietHours, notifyStatus, tokenConflict, botInfo } from '../notifier.js'
import { errText } from '../mask.js'
import { getSetting } from '../settings.js'
import { fileInfo, unitInfo } from './bots.js'

const UNIT = 'server-panel.service'
type Sent = { ts: number; text: string; ok: boolean; urgent: boolean; error?: string }

let meCache: { at: number; value: { username: string; name: string } | null; error: string | null } | null = null
export async function panelBotMe(force = false) {
  if (!force && meCache && Date.now() - meCache.at < (meCache.value ? 600_000 : 60_000)) return meCache
  let value: { username: string; name: string } | null = null
  let error: string | null = null
  if (!config.notifyToken) error = 'NOTIFY_BOT_TOKEN не задан в .env панели'
  else {
    try {
      const me = await botInfo()
      if (me) value = { username: me.username, name: me.first_name }
      else error = (await tokenConflict()) ? 'токен совпадает с токеном другого бота' : 'Telegram не ответил или не принял токен'
    } catch (e) {
      error = errText(e)
    }
  }
  meCache = { at: Date.now(), value, error }
  return meCache
}

const safe = <T>(p: Promise<T>) => p.then((data) => ({ data, error: null })).catch((e) => ({ data: null, error: errText(e) }))

export async function panelBot() {
  const [unit, me, st, files] = await Promise.all([
    safe(unitInfo(UNIT)),
    panelBotMe(),
    notifyStatus(),
    Promise.all([fileInfo(BACKEND_DIR), fileInfo(`${BACKEND_DIR}/dist/notifier.js`), fileInfo(ENV_FILE)]),
  ])
  const sent = getSetting<Sent[]>('notify.sent', [])
  const dayAgo = Date.now() - 86_400_000
  const last24 = sent.filter((x) => x.ts > dayAgo)
  const s = getNotifySettings()
  return {
    id: 'panel-notifier',
    title: 'Бот уведомлений панели (Mac Mini)',
    description:
      'Через него сама панель пишет вам в Telegram: падение служб, диск, перегрев, новые устройства, сроки, бэкапы, загрузки в обменник. Встроенный модуль панели — отдельного процесса и службы у него нет.',
    kind: 'panel-notifier' as const,
    embedded: true,
    unit: UNIT,
    logSource: `journal:${UNIT}`,
    links: [],
    paths: { dir: files[0], entry: files[1], config: files[2], log: { path: `journalctl -u ${UNIT}`, mtime: null, size: null, access: true } },
    service: unit.data ? { data: { ...unit.data, memory: unit.data.memory }, error: null } : { data: null, error: unit.error },
    runtime: { data: `Node.js ${process.versions.node} (внутри панели v${config.version})`, error: null },
    telegram: me.value ? { data: { username: me.value.username, name: me.value.name, error: null }, error: null } : { data: { username: null, error: me.error }, error: null },
    problems: { data: sent.filter((x) => !x.ok).slice(0, 10).map((x) => ({ ts: x.ts, text: x.error ?? x.text })), error: null },
    analytics: {
      data: {
        tokenSet: st.tokenSet,
        tokenConflict: st.tokenConflict,
        chatSet: s.chatId != null,
        enabled: s.enabled,
        quiet: s.quiet,
        quietNow: inQuietHours(),
        queued: st.queued,
        sent24h: last24.filter((x) => x.ok).length,
        failed24h: last24.filter((x) => !x.ok).length,
        lastSent: sent.slice(0, 8).map((x) => ({ ts: x.ts, ok: x.ok, urgent: x.urgent, text: x.text.slice(0, 160), error: x.error ?? null })),
        rulesOn: Object.values(s.rules).filter(Boolean).length,
        rulesTotal: Object.keys(st.rules).length,
      },
      error: null,
    },
  }
}
