// SSH, ключи, сессии, fail2ban, ufw-блокировки, RDP/VNC, WireGuard.
// Всё, что требует root, — через /usr/local/sbin/server-panel-helper (строгая проверка аргументов).
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { run, sudo } from '../exec.js'

const HELPER = '/usr/local/sbin/server-panel-helper'
export const helper = (args: string[], timeoutMs = 20_000) => sudo([HELPER, ...args], { timeoutMs })

// ---------- sshd ----------
async function sshdLines(file: string, depth = 0): Promise<string[]> {
  const text = await readFile(file, 'utf8').catch(() => '')
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const inc = line.match(/^Include\s+(.+)$/i)
    if (inc && depth < 3) {
      for (const pattern of inc[1].split(/\s+/)) {
        const dir = path.dirname(pattern)
        const re = new RegExp('^' + path.basename(pattern).replace(/\./g, '\\.').replace(/\*/g, '.*') + '$')
        const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => re.test(f)).sort()
        for (const f of files) out.push(...(await sshdLines(path.join(dir, f), depth + 1)))
      }
      continue
    }
    if (/^Match\s/i.test(line)) break // блоки Match не разбираем — берём глобальные настройки
    out.push(line)
  }
  return out
}

export async function sshInfo() {
  const lines = await sshdLines('/etc/ssh/sshd_config')
  // У sshd побеждает первое значение параметра
  const get = (key: string, def: string) => {
    const l = lines.find((x) => x.toLowerCase().startsWith(key.toLowerCase() + ' '))
    return l ? l.split(/\s+/)[1] : def
  }
  const [socket, service] = (await run('/usr/bin/systemctl', ['is-active', 'ssh.socket', 'ssh.service']).catch((e) => e.stdout as string))
    .trim()
    .split('\n')
  return {
    socket,
    service,
    running: socket === 'active' || service === 'active',
    port: Number(get('Port', '22')),
    passwordAuth: get('PasswordAuthentication', 'yes'),
    kbdInteractive: get('KbdInteractiveAuthentication', 'yes'),
    pubkeyAuth: get('PubkeyAuthentication', 'yes'),
    permitRootLogin: get('PermitRootLogin', 'prohibit-password'),
  }
}

// ---------- журнал sshd ----------
type Auth = { ts: number; ok: boolean; user: string; ip: string; method: string; fp: string | null; text: string }

async function sshJournal(since: string): Promise<Auth[]> {
  const out = await run(
    '/usr/bin/journalctl',
    ['-u', 'ssh.service', '-S', since, '-o', 'json', '--output-fields=MESSAGE,__REALTIME_TIMESTAMP', '--no-pager', '--grep', 'Accepted|Failed|Invalid user|authenticating user'],
    { timeoutMs: 20_000, maxBuffer: 32 * 1024 * 1024 }
  ).catch((e) => (e.code === 1 ? '' : Promise.reject(e)))
  const res: Auth[] = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const j = JSON.parse(line)
    const msg = String(j.MESSAGE ?? '')
    const ts = Math.floor(Number(j.__REALTIME_TIMESTAMP) / 1000)
    let m = msg.match(/^Accepted (\S+) for (\S+) from (\S+) port \d+ ssh2(?:: \S+ (SHA256:\S+))?/)
    if (m) {
      res.push({ ts, ok: true, method: m[1], user: m[2], ip: m[3], fp: m[4] ?? null, text: msg })
      continue
    }
    m = msg.match(/^Failed (\S+) for (?:invalid user )?(\S+) from (\S+)/) ?? msg.match(/^Invalid user (\S*) from (\S+)/)
    if (m) {
      const [user, ip, method] = m.length === 4 ? [m[2], m[3], m[1]] : [m[1], m[2], 'invalid-user']
      res.push({ ts, ok: false, method, user, ip, fp: null, text: msg })
      continue
    }
    m = msg.match(/authenticating user (\S+) (\S+) port \d+ \[preauth\]/)
    if (m) res.push({ ts, ok: false, method: 'preauth', user: m[1], ip: m[2], fp: null, text: msg })
  }
  return res
}

export async function loginHistory(days = 7) {
  const all = await sshJournal(`-${days}d`)
  return all.slice(-300).reverse()
}

// ---------- ключи ----------
const KEY_RE = /(?:^|\s)((?:ssh-(?:ed25519|rsa|dss))|(?:ecdsa-sha2-nistp\d+)|(?:sk-[\w@.-]+))\s+([A-Za-z0-9+/]+={0,3})(?:\s+(.*))?$/
const DISABLED = '#panel-disabled '

export function fingerprint(b64: string) {
  return 'SHA256:' + createHash('sha256').update(Buffer.from(b64, 'base64')).digest('base64').replace(/=+$/, '')
}

export async function listKeys() {
  const out = await helper(['keys-list'])
  const lastUse = new Map<string, { ts: number; ip: string }>()
  for (const a of await sshJournal('-90d').catch(() => [] as Auth[])) if (a.ok && a.fp) lastUse.set(`${a.user}\u0000${a.fp}`, { ts: a.ts, ip: a.ip })

  const keys = []
  for (const row of out.split('\n')) {
    if (!row) continue
    const [user, lineNo, ...rest] = row.split('\t')
    let line = rest.join('\t')
    const disabled = line.startsWith(DISABLED)
    if (disabled) line = line.slice(DISABLED.length)
    else if (line.trimStart().startsWith('#')) continue // обычные комментарии
    const m = line.match(KEY_RE)
    if (!m) continue
    const options = line.slice(0, line.length - m[0].length).trim()
    const fp = fingerprint(m[2])
    keys.push({
      user,
      line: Number(lineNo),
      type: m[1],
      fingerprint: fp,
      comment: m[3]?.trim() || null,
      options: options || null,
      restricted: /command=|restrict/.test(options),
      disabled,
      lastUsed: lastUse.get(`${user}\u0000${fp}`) ?? null,
    })
  }
  return keys
}

// ---------- сессии ----------
export async function activeSessions() {
  const list = JSON.parse(await run('/usr/bin/loginctl', ['list-sessions', '-o', 'json'])) as { session: string; user: string; tty: string | null }[]
  if (!list.length) return []
  // loginctl, в отличие от systemctl, не принимает список свойств через запятую
  const props = ['Id', 'Name', 'Remote', 'RemoteHost', 'Service', 'TTY', 'Timestamp', 'State', 'Type', 'Class'].flatMap((p) => ['-p', p])
  const out = await run('/usr/bin/loginctl', ['show-session', ...list.map((s) => s.session), ...props])
  return out
    .split('\n\n')
    .map((b) => Object.fromEntries(b.split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])))
    .filter((o) => o.Id && o.Class === 'user')
    .map((o) => ({
      id: o.Id,
      user: o.Name,
      remote: o.Remote === 'yes',
      from: o.RemoteHost || null,
      service: o.Service || null,
      tty: o.TTY || null,
      type: o.Type,
      since: Date.parse(String(o.Timestamp).replace(/ [A-Z]{3,5}$/, '')) || null,
      killable: o.Service === 'sshd' || o.Service === 'xrdp-sesman',
    }))
}

// ---------- fail2ban ----------
export async function fail2ban() {
  const out = await helper(['f2b-status'])
  const jails: { name: string; currentlyFailed: number; totalFailed: number; currentlyBanned: number; totalBanned: number; banned: string[] }[] = []
  for (const block of out.split('=== ').slice(1)) {
    const name = block.split('\n')[0].trim()
    const num = (label: string) => Number(block.match(new RegExp(`${label}:\\s*(\\d+)`))?.[1] ?? 0)
    const banned = (block.match(/Banned IP list:\s*(.*)/)?.[1] ?? '').trim().split(/\s+/).filter(Boolean)
    jails.push({ name, currentlyFailed: num('Currently failed'), totalFailed: num('Total failed'), currentlyBanned: num('Currently banned'), totalBanned: num('Total banned'), banned })
  }
  const conf = await readFile('/etc/fail2ban/jail.local', 'utf8').catch(() => '')
  const ignoreip = conf.match(/^ignoreip\s*=\s*(.+)$/m)?.[1]?.trim().split(/\s+/) ?? []
  return { jails, ignoreip }
}

// ---------- ufw: блокировки ----------
export async function ufwDenies() {
  const out = await helper(['ufw-list'])
  return out
    .split('\n')
    .map((l) => l.match(/^\[\s*(\d+)\]\s+(.+?)\s{2,}DENY IN\s{2,}(\S+)(?:\s+#\s*(.*))?$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ num: Number(m[1]), to: m[2].trim(), from: m[3], comment: m[4] ?? null, panel: m[4] === 'server-panel' }))
}

// ---------- WireGuard ----------
export async function wireguard() {
  const [out, status] = await Promise.all([
    helper(['wg-dump']),
    run('/usr/bin/systemctl', ['is-active', 'wg-quick@wg0.service']).catch((e) => (e.stdout as string) || 'unknown'),
  ])
  let iface: { publicKey: string; port: number } | null = null
  const peers: { publicKey: string; name: string | null; endpoint: string | null; allowedIps: string; handshake: number | null; rx: number; tx: number }[] = []
  const names = new Map<string, string>()
  for (const l of out.split('\n')) {
    const f = l.split('\t')
    if (f[0] === 'interface') iface = { publicKey: f[1], port: Number(f[2]) }
    else if (f[0] === 'peer')
      peers.push({ publicKey: f[1], name: null, endpoint: f[2] === '(none)' ? null : f[2], allowedIps: f[3], handshake: Number(f[4]) > 0 ? Number(f[4]) * 1000 : null, rx: Number(f[5]), tx: Number(f[6]) })
    else if (f[0] === 'name') names.set(f[1], f[2])
  }
  for (const p of peers) p.name = names.get(p.publicKey) ?? null
  return { status: status.trim(), iface, peers }
}

// ---------- RDP / VNC ----------
export async function remoteDesktop() {
  const ss = await run('/usr/bin/ss', ['-tlnH', 'sport = :3389 or sport = :5900'])
  const [xrdp] = (await run('/usr/bin/systemctl', ['is-active', 'xrdp.service']).catch((e) => e.stdout as string)).trim().split('\n')
  return {
    rdp: { service: xrdp, listening: /:3389\s/.test(ss), port: 3389 },
    vnc: { listening: /:5900\s/.test(ss), port: 5900 },
  }
}
