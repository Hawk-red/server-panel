// Блокировки: бан fail2ban (jail panel-auth, через root-утилиту) и блокировки самой панели (подбор пароля/кода).
import { clearIpBlock, listPanelBlocks } from '../auth.js'
import { run } from '../exec.js'
import { errText } from '../mask.js'

const HELPER = process.env.F2B_HELPER ?? '/usr/local/sbin/server-panel-f2b'
// F2B_SUDO / F2B_HELPER заданы только в автотестах (подмена sudo и утилиты); в рабочей панели не задаются
const SUDO = process.env.F2B_SUDO ?? '/usr/bin/sudo'
const sudo = (args: string[], opts: { timeoutMs?: number; input?: string }) => run(SUDO, ['-n', ...args], opts)

export type F2bBan = { ip: string; bannedAt: number; unbanAt: number }

// Строка get panel-auth banip --with-time: «IP \t 2026-10-06 01:10:00 + 3600 = 2026-10-06 02:10:00» (время локальное)
const LINE = /^(\S+)\s+(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) \+ (\d+) = (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\s*$/
const ts = (s: string) => Date.parse(s.replace(' ', 'T'))

export async function f2bBans(): Promise<{ items: F2bBan[]; error: string | null }> {
  try {
    const out = await sudo([HELPER, 'status'], { timeoutMs: 15_000 })
    const items: F2bBan[] = []
    for (const l of out.split('\n')) {
      const m = LINE.exec(l.trim())
      if (m) items.push({ ip: m[1], bannedAt: ts(m[2]), unbanAt: ts(m[4]) })
    }
    return { items: items.sort((a, b) => b.unbanAt - a.unbanAt), error: null }
  } catch (e) {
    const msg = errText(e)
    return { items: [], error: /password is required|not allowed|a terminal is required/i.test(msg) ? 'нет прав (sudoers / server-panel-f2b не установлены)' : /jail|Sorry|NOK/i.test(msg) ? 'jail panel-auth не включён (install-fail2ban.sh)' : msg.slice(0, 200) }
  }
}

export async function blocksOverview() {
  return { panel: listPanelBlocks(), fail2ban: await f2bBans() }
}

// Снять блокировки адреса и там, и там; счётчик неудач обнуляется. ip уже проверен parseIpStrict
export async function unblock(ip: string) {
  const panel = clearIpBlock(ip)
  let fail2ban = false
  let f2bError: string | null = null
  try {
    const out = await sudo([HELPER, 'unbanip'], { timeoutMs: 15_000, input: `${ip}\n` })
    fail2ban = out.trim() === 'unbanned'
  } catch (e) {
    const msg = errText(e)
    f2bError = /password is required|not allowed/i.test(msg) ? 'fail2ban: нет прав (sudoers / server-panel-f2b не установлены)' : /jail|Sorry|NOK/i.test(msg) ? 'fail2ban: jail panel-auth не включён' : `fail2ban: ${msg.slice(0, 160)}`
  }
  return { panel, fail2ban, f2bError, unblocked: panel || fail2ban }
}
