// Двухфакторный вход (TOTP) и доступ из интернета: состояние хранится в настройках панели (SQLite),
// секрет TOTP — зашифрованным (secretbox.ts), коды восстановления — только хэшами.
import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { getSetting, setSetting } from './settings.js'
import { decryptSecret, encryptSecret } from './secretbox.js'
import { newSecret, otpauthUrl, qrSvg, verifyTotp } from './totp.js'

const KEY = 'security.totp'
const PENDING = 'security.totp.pending'
const EXTERNAL = 'security.external'
const ISSUER = 'Mac Mini'
const RECOVERY_COUNT = 10
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789' // без похожих символов

type State = { enabled: boolean; secretEnc: string; lastStep: number; recovery: string[]; enabledAt: number }

const state = () => getSetting<State | null>(KEY, null)
export const totpEnabled = () => state()?.enabled === true
export const recoveryLeft = () => state()?.recovery.length ?? 0
export const enabledAt = () => state()?.enabledAt ?? null

// Доступ из интернета (кнопка в «Безопасности»): по умолчанию выключен, включается только при включённой 2FA
export const externalEnabled = () => getSetting<boolean>(EXTERNAL, false) && totpEnabled()
export function setExternal(on: boolean) {
  if (on && !totpEnabled()) throw Object.assign(new Error('Сначала включите двухфакторный вход'), { statusCode: 409 })
  setSetting(EXTERNAL, on)
}

const hashRecovery = (code: string) => createHash('sha256').update(normalizeRecovery(code)).digest('hex')
const normalizeRecovery = (c: string) => c.toLowerCase().replace(/[\s-]/g, '')

function newRecoveryCodes() {
  const codes = Array.from({ length: RECOVERY_COUNT }, () => {
    const raw = Array.from({ length: 10 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join('')
    return `${raw.slice(0, 5)}-${raw.slice(5)}`
  })
  return { codes, hashes: codes.map(hashRecovery) }
}

// Шаг 1 включения: новый секрет (пока не активен) + QR локально
export async function startSetup(account: string) {
  if (totpEnabled()) throw Object.assign(new Error('Двухфакторный вход уже включён'), { statusCode: 409 })
  const secret = newSecret()
  setSetting(PENDING, { secretEnc: encryptSecret(secret), at: Date.now() })
  const url = otpauthUrl(secret, account, ISSUER)
  return { secret, otpauth: url, qr: await qrSvg(url) }
}

// Шаг 2: подтверждение первым кодом → 2FA включена, выдаются коды восстановления (показываются один раз)
export function confirmSetup(code: string): { recoveryCodes: string[] } | null {
  const pending = getSetting<{ secretEnc: string; at: number } | null>(PENDING, null)
  if (!pending || Date.now() - pending.at > 15 * 60_000) return null
  const step = verifyTotp(decryptSecret(pending.secretEnc), code, 0)
  if (step === null) return null
  const { codes, hashes } = newRecoveryCodes()
  setSetting(KEY, { enabled: true, secretEnc: pending.secretEnc, lastStep: step, recovery: hashes, enabledAt: Date.now() } satisfies State)
  setSetting(PENDING, null)
  return { recoveryCodes: codes }
}

export type Factor = { kind: 'totp'; step: number } | { kind: 'recovery'; hash: string }

// Проверка без изменения состояния: подходит ли код (TOTP, ещё не использованный, либо одноразовый код восстановления)
export function peekSecondFactor(code: string): Factor | null {
  const st = state()
  if (!st?.enabled || typeof code !== 'string') return null
  const c = code.trim()
  if (/^\d{6}$/.test(c)) {
    const step = verifyTotp(decryptSecret(st.secretEnc), c, st.lastStep)
    return step === null ? null : { kind: 'totp', step }
  }
  const h = Buffer.from(hashRecovery(c))
  let hit: string | null = null
  for (const r of st.recovery) {
    const rb = Buffer.from(r)
    if (rb.length === h.length && timingSafeEqual(rb, h)) hit = r // без раннего выхода
  }
  return hit ? { kind: 'recovery', hash: hit } : null
}

// «Погашение» кода: повторно проверяет и запоминает использование. false — код уже использован (в том числе параллельным запросом)
export function consumeSecondFactor(f: Factor): boolean {
  const st = state()
  if (!st?.enabled) return false
  if (f.kind === 'totp') {
    if (f.step <= st.lastStep) return false
    setSetting(KEY, { ...st, lastStep: f.step })
    return true
  }
  if (!st.recovery.includes(f.hash)) return false
  setSetting(KEY, { ...st, recovery: st.recovery.filter((x) => x !== f.hash) })
  return true
}

export function disableTotp() {
  setSetting(KEY, null)
  setSetting(PENDING, null)
  setSetting(EXTERNAL, false)
}

// Пересоздание кодов восстановления (старые перестают работать)
export function regenerateRecovery(): string[] {
  const st = state()
  if (!st?.enabled) throw Object.assign(new Error('Двухфакторный вход не включён'), { statusCode: 409 })
  const { codes, hashes } = newRecoveryCodes()
  setSetting(KEY, { ...st, recovery: hashes })
  return codes
}
