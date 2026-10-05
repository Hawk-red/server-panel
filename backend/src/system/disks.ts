import { readFile } from 'node:fs/promises'
import { type ExecError, run, sudo } from '../exec.js'
import { readFsUsage } from '../collector/sources.js'

export type Smart = {
  status: 'ok' | 'failing' | 'standby' | 'unavailable'
  temperature: number | null
  powerOnHours: number | null
  checkedAt: number
  error?: string
}

export type DiskInfo = {
  device: string // /dev/sdb5
  disk: string // /dev/sdb
  model: string | null
  label: string | null
  uuid: string | null
  fstype: string | null
  transport: string | null
  mount: string | null
  size: number
  used: number | null
  free: number | null
  percent: number | null
  inFstab: boolean
  // stale — точка смонтирована, но диск не отвечает (ошибки I/O): чтение статистики не удалось
  state: 'mounted' | 'stale' | 'missing' | 'unmounted'
  smart: Smart | null
}

type LsblkNode = {
  name: string
  path: string
  size: number
  type: string
  fstype: string | null
  mountpoint: string | null
  model: string | null
  label: string | null
  uuid: string | null
  tran: string | null
  children?: LsblkNode[]
}

type FstabEntry = { spec: string; mount: string; fstype: string }

async function readFstab(): Promise<FstabEntry[]> {
  const text = await readFile('/etc/fstab', 'utf8')
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(/\s+/))
    .filter((f) => f.length >= 3 && f[2] !== 'swap' && !f[3]?.split(',').includes('bind'))
    .map((f) => ({ spec: f[0], mount: f[1], fstype: f[2] }))
}

// SMART кэшируется: опрос раз в 10 минут, спящие диски не будим (-n standby)
const smartCache = new Map<string, Smart>()
const SMART_TTL = 10 * 60 * 1000

async function querySmart(disk: string): Promise<Smart> {
  let stdout = ''
  let errText = ''
  try {
    stdout = await sudo(['/usr/sbin/smartctl', '-j', '-a', '-n', 'standby', disk], { timeoutMs: 20_000 })
  } catch (e) {
    // Код выхода smartctl — битовая маска: данные в stdout бывают и при ненулевом коде
    const err = e as ExecError
    stdout = err.stdout ?? ''
    errText = `${err.stderr ?? ''} ${err.message ?? ''}`
  }
  if (/STANDBY|SLEEP/i.test(stdout + errText)) {
    return { status: 'standby', temperature: null, powerOnHours: null, checkedAt: Date.now() }
  }
  try {
    const smart = parseSmart(JSON.parse(stdout))
    if (smart.status !== 'unavailable' || smart.temperature !== null) return smart
    errText ||= 'диск не отдаёт SMART'
  } catch {
    errText ||= 'некорректный ответ smartctl'
  }
  return { status: 'unavailable', temperature: null, powerOnHours: null, checkedAt: Date.now(), error: shortError(errText) }
}

function shortError(text: string) {
  if (/a password is required|not allowed to execute|sudo:/i.test(text)) return 'нет прав (sudoers)'
  return text.trim().split('\n')[0].slice(0, 120)
}

function parseSmart(j: any): Smart {
  const passed = j?.smart_status?.passed
  return {
    status: passed === false ? 'failing' : passed === true ? 'ok' : 'unavailable',
    temperature: typeof j?.temperature?.current === 'number' ? j.temperature.current : null,
    powerOnHours: typeof j?.power_on_time?.hours === 'number' ? j.power_on_time.hours : null,
    checkedAt: Date.now(),
  }
}

export async function getSmart(disk: string, force = false): Promise<Smart> {
  const cached = smartCache.get(disk)
  if (!force && cached && Date.now() - cached.checkedAt < SMART_TTL) return cached
  const fresh = await querySmart(disk)
  smartCache.set(disk, fresh)
  return fresh
}

export function cachedSmart(disk: string): Smart | null {
  return smartCache.get(disk) ?? null
}

export async function listDisks(): Promise<DiskInfo[]> {
  const out = await run('/usr/bin/lsblk', ['-J', '-b', '-o', 'NAME,PATH,SIZE,TYPE,FSTYPE,MOUNTPOINT,MODEL,LABEL,UUID,TRAN'])
  const tree = JSON.parse(out).blockdevices as LsblkNode[]
  const fstab = await readFstab().catch(() => [] as FstabEntry[])
  const result: DiskInfo[] = []
  const seenMounts = new Set<string>()

  for (const disk of tree) {
    if (disk.type !== 'disk') continue
    const parts = disk.children?.length ? disk.children : [disk]
    for (const p of parts) {
      if (!p.fstype || p.fstype === 'swap') continue
      const fsEntry = fstab.find((f) => f.spec === `UUID=${p.uuid}` || f.spec === p.path || f.mount === p.mountpoint)
      let usage: Awaited<ReturnType<typeof readFsUsage>> | null = null
      if (p.mountpoint) {
        usage = await readFsUsage(p.mountpoint).catch(() => null)
        seenMounts.add(p.mountpoint)
      }
      result.push({
        device: p.path,
        disk: disk.path,
        model: disk.model?.trim() || null,
        label: p.label,
        uuid: p.uuid,
        fstype: p.fstype,
        transport: disk.tran,
        mount: p.mountpoint ?? fsEntry?.mount ?? null,
        size: p.size,
        used: usage?.used ?? null,
        free: usage?.free ?? null,
        percent: usage?.percent ?? null,
        inFstab: Boolean(fsEntry),
        state: p.mountpoint ? (usage ? 'mounted' : 'stale') : 'unmounted',
        smart: cachedSmart(disk.path),
      })
    }
  }

  // Точки из fstab, для которых нет устройства — «отвалился»
  for (const f of fstab) {
    if (seenMounts.has(f.mount) || result.some((r) => r.mount === f.mount)) continue
    result.push({
      device: f.spec,
      disk: f.spec,
      model: null,
      label: null,
      uuid: f.spec.startsWith('UUID=') ? f.spec.slice(5) : null,
      fstype: f.fstype,
      transport: null,
      mount: f.mount,
      size: 0,
      used: null,
      free: null,
      percent: null,
      inFstab: true,
      state: 'missing',
      smart: null,
    })
  }
  return result
}

// Фоновое обновление SMART для всех физических дисков
export async function refreshAllSmart() {
  const out = await run('/usr/bin/lsblk', ['-J', '-d', '-o', 'PATH,TYPE'])
  const disks = (JSON.parse(out).blockdevices as { path: string; type: string }[]).filter((d) => d.type === 'disk')
  for (const d of disks) await getSmart(d.path, true)
}
