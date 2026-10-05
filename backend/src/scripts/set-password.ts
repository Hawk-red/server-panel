// Задать/сменить пароль панели: хэш argon2id пишется в backend/.env (chmod 600).
// Запуск: sudo -u panel node /opt/server-panel/backend/dist/scripts/set-password.js
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Writable } from 'node:stream'
import readline from 'node:readline/promises'
import { hash } from '@node-rs/argon2'
import { ENV_FILE } from '../config.js'
import { db } from '../db.js'

let muted = false
const output = new Writable({
  write(chunk, _enc, cb) {
    if (!muted) process.stdout.write(chunk)
    cb()
  },
})
const rl = readline.createInterface({ input: process.stdin, output, terminal: true })

async function ask(prompt: string) {
  process.stdout.write(prompt)
  muted = true
  const answer = await rl.question('')
  muted = false
  process.stdout.write('\n')
  return answer
}

const first = await ask('Новый пароль панели: ')
if (first.length < 10) {
  console.error('Пароль слишком короткий (нужно минимум 10 символов).')
  process.exit(1)
}
const second = await ask('Повторите пароль: ')
rl.close()
if (first !== second) {
  console.error('Пароли не совпадают.')
  process.exit(1)
}

const passwordHash = await hash(first)
const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8').split('\n') : ['# Секреты панели — только для пользователя panel (chmod 600)']
const idx = lines.findIndex((l) => l.startsWith('PANEL_PASSWORD_HASH='))
if (idx >= 0) lines[idx] = `PANEL_PASSWORD_HASH=${passwordHash}`
else lines.push(`PANEL_PASSWORD_HASH=${passwordHash}`)
writeFileSync(ENV_FILE, lines.filter((l, i) => l !== '' || i < lines.length - 1).join('\n') + '\n', { mode: 0o600 })
chmodSync(ENV_FILE, 0o600)
// Смена пароля завершает все сессии (в том числе внешние)
const ended = db.prepare('DELETE FROM sessions').run().changes
console.log(`Завершено сессий: ${ended}`)
console.log(`Готово: хэш записан в ${ENV_FILE}. Перезапустите службу: sudo systemctl restart server-panel`)
