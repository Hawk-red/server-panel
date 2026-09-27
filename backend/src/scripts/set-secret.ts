// Записать секрет в backend/.env (chmod 600, владелец panel), ввод скрыт.
// Запуск: sudo -u panel node /opt/server-panel/backend/dist/scripts/set-secret.js QBT_PASSWORD
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Writable } from 'node:stream'
import readline from 'node:readline/promises'
import { ENV_FILE } from '../config.js'

const ALLOWED = ['QBT_USER', 'QBT_PASSWORD', 'ADGUARD_USER', 'ADGUARD_PASSWORD', 'JELLYFIN_API_KEY', 'NOTIFY_BOT_TOKEN']
const key = process.argv[2]
if (!key || !ALLOWED.includes(key)) {
  console.error(`Укажите ключ: ${ALLOWED.join(', ')}`)
  process.exit(1)
}

let muted = false
const output = new Writable({
  write(chunk, _enc, cb) {
    if (!muted) process.stdout.write(chunk)
    cb()
  },
})
const rl = readline.createInterface({ input: process.stdin, output, terminal: true })
process.stdout.write(`${key}: `)
muted = true
const value = (await rl.question('')).trim()
muted = false
rl.close()
process.stdout.write('\n')
if (!value || /[\r\n]/.test(value)) {
  console.error('Пустое или некорректное значение.')
  process.exit(1)
}

const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8').split('\n').filter((l, i, a) => l !== '' || i < a.length - 1) : []
const idx = lines.findIndex((l) => l.startsWith(`${key}=`))
if (idx >= 0) lines[idx] = `${key}=${value}`
else lines.push(`${key}=${value}`)
writeFileSync(ENV_FILE, lines.join('\n') + '\n', { mode: 0o600 })
chmodSync(ENV_FILE, 0o600)
console.log(`Готово: ${key} записан. Перезапустите службу: sudo systemctl restart server-panel`)
