// Диагностика сопряжения с телевизором Samsung: открывает WebSocket тем же именем, что и панель, и печатает
// всё, что присылает ТВ (события, коды закрытия, наличие токена — без его значения). Ключи НЕ отправляются.
// ⚠️ При запуске на экране телевизора может появиться окно «Разрешить подключение».
// Запуск: node dist/scripts/probe-tv-ws.js [8002|8001] [секунды] [apps]
// «apps» — дополнительно запросить у ТВ список установленных приложений (ed.installedApp.get): это чтение,
// не нажатие кнопки, но отвечает на него только авторизованный канал — так видно, принял ТВ панель или нет.
import WebSocket from 'ws'
import { config } from '../config.js'
import { errText, maskSecrets } from '../mask.js'

const port = Number(process.argv[2] ?? 8002) === 8001 ? 8001 : 8002
const waitSec = Number(process.argv[3] ?? 30) || 30
// Адрес — как в services/tv.ts (имя клиента в base64, без токена: проверяем именно первое сопряжение)
const NAME = Buffer.from('ServerPanel').toString('base64')
const url = `${port === 8002 ? 'wss' : 'ws'}://${config.tv.host}:${port}/api/v2/channels/samsung.remote.api.v2?name=${NAME}`

const t0 = Date.now()
const log = (...parts: unknown[]) => console.log(`+${String((Date.now() - t0) / 1000).padStart(5, ' ')}с  ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`)

/** Показать сообщение ТВ без значения токена */
function describe(raw: string): string {
  try {
    const m = JSON.parse(raw) as { event?: string; data?: Record<string, unknown> }
    const d = (m.data ?? {}) as { token?: unknown; clients?: unknown[]; id?: unknown }
    const parts = [`event=${m.event ?? '—'}`]
    if ('token' in d) parts.push(`data.token: ЕСТЬ (длина ${String(d.token).length}, значение не печатаем)`)
    else if (m.data) parts.push('data.token: НЕТ')
    if (Array.isArray(d.clients)) parts.push(`clients=${d.clients.length}`)
    const rest = JSON.stringify(m, (k, v) => (k === 'token' || k === 'id' ? '<скрыто>' : v))
    return `${parts.join(', ')}  ${maskSecrets(rest).slice(0, 400)}`
  } catch {
    return maskSecrets(raw).slice(0, 400)
  }
}

console.log(`Телевизор ${config.tv.host}, порт ${port}, имя клиента ServerPanel (base64 ${NAME})`)
console.log(`Жду ответы ${waitSec} с. На экране телевизора может появиться окно «Разрешить» — подтвердите его.`)
console.log('Ключи не отправляются.\n')
log('открываю', maskSecrets(url))

const ws = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: 10_000 })
ws.on('upgrade', (res) => log(`HTTP-апгрейд принят: ${res.statusCode}`))
ws.on('unexpected-response', (_req, res) => log(`ТВ ответил HTTP ${res.statusCode} вместо WebSocket`))
const askApps = process.argv.includes('apps')
ws.on('open', () => log('сокет открыт, жду события от ТВ'))
let asked = false
ws.on('message', (d: Buffer) => {
  const raw = d.toString()
  log('сообщение:', describe(raw))
  if (askApps && !asked && raw.includes('ms.channel.connect')) {
    asked = true
    log('запрашиваю список приложений (чтение, не кнопка)')
    ws.send(JSON.stringify({ method: 'ms.channel.emit', params: { event: 'ed.installedApp.get', to: 'host' } }))
  }
})
ws.on('error', (e) => log('ошибка:', errText(e)))
ws.on('close', (code, reason) => log(`сокет закрыт: код ${code}${reason?.length ? `, причина ${maskSecrets(reason.toString())}` : ''}`))

setTimeout(() => {
  log('время вышло, закрываю')
  ws.close()
  setTimeout(() => process.exit(0), 300)
}, waitSec * 1000)
