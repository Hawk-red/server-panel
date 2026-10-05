// Шифрование небольших секретов в SQLite (секрет TOTP): AES-256-GCM. Ключ — файл в каталоге данных (0600), не в репозитории.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

const KEY_FILE = path.join(config.dataDir, 'secret.key')

function loadKey(): Buffer {
  if (!existsSync(KEY_FILE)) {
    // wx: не перезаписывать существующий файл при гонке двух процессов
    writeFileSync(KEY_FILE, randomBytes(32).toString('hex') + '\n', { mode: 0o600, flag: 'wx' })
  }
  chmodSync(KEY_FILE, 0o600)
  const key = Buffer.from(readFileSync(KEY_FILE, 'utf8').trim(), 'hex')
  if (key.length !== 32) throw new Error('повреждён файл ключа шифрования (secret.key)')
  return key
}

let key: Buffer | null = null
const getKey = () => (key ??= loadKey())

// Формат: v1.<iv>.<tag>.<шифртекст> (base64url)
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', getKey(), iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.')
}

export function decryptSecret(blob: string): string {
  const [v, iv, tag, ct] = blob.split('.')
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('неверный формат зашифрованного секрета')
  const d = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64url'))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8')
}
