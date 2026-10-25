import net from 'node:net'
import { config } from '../config.js'
import { errText } from '../mask.js'

// Только чтение: что отвечает телевизор Samsung. Ничего не отправляет и не сопрягает.
// Запуск, когда ТВ включён: node dist/scripts/probe-tv.js
const host = config.tv.host
const tcp = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.createConnection({ host, port })
    const done = (ok: boolean) => {
      s.destroy()
      resolve(ok)
    }
    s.setTimeout(2000, () => done(false))
    s.once('connect', () => done(true))
    s.once('error', () => done(false))
  })

console.log(`Телевизор ${host}`)
for (const port of [8001, 8002, 55000]) console.log(`  TCP ${port}: ${(await tcp(port)) ? 'открыт' : 'закрыт / нет ответа'}`)
try {
  const r = await fetch(`http://${host}:8001/api/v2/`, { signal: AbortSignal.timeout(3000) })
  const j = (await r.json()) as { device?: Record<string, unknown>; isSupport?: string; version?: string }
  const d = j.device ?? {}
  console.log(`  GET :8001/api/v2/ → HTTP ${r.status}`)
  console.log(`  Модель: ${d.modelName ?? '—'} (${d.name ?? '—'}), год: ${d.model ?? '—'}, ОС: ${d.OS ?? '—'}`)
  console.log(`  PowerState: ${d.PowerState ?? '— (поле отсутствует)'}, FrameTVSupport: ${d.FrameTVSupport ?? '—'}, TokenAuthSupport: ${d.TokenAuthSupport ?? '—'}`)
  const sup = j.isSupport ? (JSON.parse(j.isSupport) as Record<string, unknown>) : null
  console.log(`  Поддержка: ${sup ? Object.entries(sup).map(([k, v]) => `${k}=${v}`).join(', ') : '—'}`)
  console.log(`  Версия API: ${j.version ?? '—'}`)
} catch (e) {
  console.log(`  GET :8001/api/v2/ — нет ответа (${errText(e)})`)
}
