import { isIP } from 'node:net'

// IPv4-проверка клиента: '::ffff:1.2.3.4' → '1.2.3.4', '::1' → '127.0.0.1'
export function normalizeIp(ip: string | undefined): string {
  if (!ip) return ''
  if (ip === '::1') return '127.0.0.1'
  if (ip.startsWith('::ffff:')) return ip.slice(7)
  return ip
}

function ipToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null
    n = n * 256 + Number(p)
  }
  return n
}

export function inCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/')
  const bits = Number(bitsStr ?? 32)
  const a = ipToInt(ip)
  const b = ipToInt(base)
  if (a === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return ((a & mask) >>> 0) === ((b & mask) >>> 0)
}

export function isAllowed(ip: string, nets: string[]): boolean {
  return nets.some((cidr) => inCidr(ip, cidr))
}

// Строгая проверка IP-адреса из пользовательского ввода: только корректный IPv4 или IPv6 (без пробелов, зон %eth0, портов, масок
// и прочих символов). Возвращает нормализованный адрес или null.
export function parseIpStrict(input: unknown): string | null {
  if (typeof input !== 'string' || input.length < 2 || input.length > 45) return null
  if (!/^[0-9A-Fa-f:.]+$/.test(input)) return null
  const v = isIP(input)
  if (v === 0) return null
  return v === 6 ? input.toLowerCase() : input
}

export type NetworkKind = 'lan' | 'vpn' | 'local'

export function networkOf(ip: string): NetworkKind {
  if (inCidr(ip, '10.10.10.0/24')) return 'vpn'
  if (inCidr(ip, '127.0.0.0/8')) return 'local'
  return 'lan'
}

// «Внутренний» клиент: домашняя сеть, WireGuard или сам сервер. Остальные — «внешние» (из интернета через nginx).
// Единственное место, где это решается: везде в панели используется isInternal(req), адрес — req.ip (trustProxy только для 127.0.0.1).
export const INTERNAL_NETS = ['192.168.31.0/24', '10.10.10.0/24', '127.0.0.1/32']
export const isInternalIp = (ip: string) => isAllowed(normalizeIp(ip), INTERNAL_NETS)
export const isInternal = (req: { ip: string }) => isInternalIp(req.ip)
