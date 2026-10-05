// TOTP по RFC 6238 (HMAC-SHA1, 6 цифр, шаг 30 с) и RFC 4226 (HOTP). Только стандартная библиотека Node.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import QRCode from 'qrcode'

export const STEP_SEC = 30
export const DIGITS = 6
export const WINDOW = 1 // ±1 шаг (±30 с) на расхождение часов

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of buf) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of s.toUpperCase().replace(/[\s=-]/g, '')) {
    const i = B32.indexOf(ch)
    if (i < 0) throw new Error('неверный символ base32')
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export const newSecret = () => base32Encode(randomBytes(20)) // 160 бит, 32 символа

export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const h = createHmac('sha1', secret).update(msg).digest()
  const o = h[h.length - 1] & 15
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(bin % 10 ** digits).padStart(digits, '0')
}

export const stepOf = (nowMs = Date.now()) => Math.floor(nowMs / 1000 / STEP_SEC)

/**
 * Проверка кода. Возвращает номер шага, по которому код подошёл (его нужно запомнить, чтобы тот же код не приняли второй раз),
 * либо null. Шаги не больше lastStep отклоняются: повтор кода и «откат» назад невозможны.
 */
export function verifyTotp(secretB32: string, code: string, lastStep: number, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const secret = base32Decode(secretB32)
  const cur = stepOf(nowMs)
  let found: number | null = null
  // перебираем все шаги окна без раннего выхода: время проверки не зависит от того, какой шаг подошёл
  for (let s = cur - WINDOW; s <= cur + WINDOW; s++) {
    const a = Buffer.from(hotp(secret, s))
    const b = Buffer.from(code)
    if (a.length === b.length && timingSafeEqual(a, b) && s > lastStep && (found === null || s > found)) found = s
  }
  return found
}

export const otpauthUrl = (secretB32: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SEC}`

// QR строится локально (SVG-строка), без внешних сервисов
export const qrSvg = (text: string) => QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
