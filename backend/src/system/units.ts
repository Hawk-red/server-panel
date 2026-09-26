import { run, sudo } from '../exec.js'
import { listContainers } from '../services/docker.js'

// Службы, которыми можно управлять из панели (start/stop/restart через sudoers).
// ssh, wg-quick@wg0, docker — не здесь: ими займутся этапы 3 и 5 с отдельными предупреждениями.
export const CONTROLLABLE: Record<string, { title: string; warning?: string }> = {
  'nginx.service': {
    title: 'nginx',
    warning: 'Вместе с nginx перестанут открываться зеркало jetsetter, api.pulsdev.net (снаружи) и File Browser.',
  },
  'php8.3-fpm.service': { title: 'PHP-FPM 8.3', warning: 'Зеркало jetsetter перестанет отвечать (502).' },
  'mariadb.service': { title: 'MariaDB', warning: 'Зеркало jetsetter потеряет базу данных.' },
  'mongod.service': { title: 'MongoDB', warning: 'Зеркало jetsetter потеряет MongoDB.' },
  'smbd.service': { title: 'Samba (smbd)', warning: 'Отключится SMB-шара MacMIniTorrents.' },
  'nmbd.service': { title: 'Samba (nmbd)' },
  'xrdp.service': { title: 'xrdp (RDP)', warning: 'Активные RDP-сессии будут разорваны.' },
  'fail2ban.service': { title: 'fail2ban', warning: 'Защита SSH от перебора паролей временно отключится.' },
  'triggerhappy.service': { title: 'triggerhappy (ИК-пульт)' },
  'alert_monitor.service': { title: 'Air Alert Monitor (Telegram)' },
  'pulsdev-api.service': { title: 'pulsdev.net Lead API', warning: 'api.pulsdev.net перестанет отвечать.' },
  'thermal-watchdog.service': { title: 'thermal-watchdog', warning: 'Аварийная защита от перегрева отключится.' },
  'mbpfan.service': { title: 'mbpfan (вентилятор)', warning: 'Вентилятор перестанет регулироваться — возможен перегрев.' },
  'smartmontools.service': { title: 'smartmontools' },
  'cron.service': { title: 'cron', warning: 'Перестанут выполняться задачи по расписанию (синк, бэкапы, мониторинг).' },
}

export const ACTIONS = ['start', 'stop', 'restart'] as const
export type UnitAction = (typeof ACTIONS)[number]

// Системный фон — сворачивается в отдельную группу
const BACKGROUND = [
  /^(dbus|getty@|serial-getty@|systemd-|user@|user-runtime-dir@|polkit|accounts-daemon|udisks2|upower|rtkit-daemon|colord|kerneloops)/,
  /^(ModemManager|NetworkManager|wpa_supplicant|bolt|switcheroo-control|power-profiles-daemon|fwupd|cups|avahi-daemon|bluetooth|gdm)/,
  /^(snapd|rsyslog|thermald|unattended-upgrades|apport|setvtrgb|keyboard-setup|console-setup|grub-|cloud-|secureboot-db|ua-|ubuntu-)/,
  /^(e2scrub|binfmt-support|networkd-dispatcher|gpu-manager|dmesg|lm-sensors|anacron|apparmor|ssl-cert|openvpn\.service|plymouth|alsa-|kmod|modprobe@|ufw\.service|logrotate|man-db|motd-news|apt-|dpkg-db-backup|packagekit|sysstat|update-notifier|lvm2|multipathd|finalrd|pollinate|rc-local|blk-availability)/,
  /^(emergency|rescue|initrd-|ldconfig|tpm-udev|getty-static|netplan-|nftables|uuidd|whoopsie|pulseaudio-enable-autospawn|fstrim|samba-ad-dc|systemd)/,
]
export const isBackground = (unit: string) => BACKGROUND.some((re) => re.test(unit))

export type ServiceRow = {
  unit: string
  description: string
  load: string
  active: string
  sub: string
  enabled: string | null
  since: number | null
  mainPid: number | null
  memory: number | null
  background: boolean
  controllable: boolean
  warning?: string
}

type ShowBlock = Record<string, string>

function parseShow(text: string): ShowBlock[] {
  return text
    .split('\n\n')
    .map((block) => {
      const o: ShowBlock = {}
      for (const line of block.split('\n')) {
        const i = line.indexOf('=')
        if (i > 0) o[line.slice(0, i)] = line.slice(i + 1)
      }
      return o
    })
    .filter((o) => o.Id)
}

const tsOf = (v?: string) => {
  if (!v || v === 'n/a') return null
  const t = Date.parse(v.replace(/ [A-Z]{3,5}$/, ''))
  return Number.isFinite(t) ? t : null
}

export async function listServices(): Promise<ServiceRow[]> {
  const units = JSON.parse(await run('/usr/bin/systemctl', ['list-units', '--type=service', '--all', '-o', 'json'])) as {
    unit: string
    load: string
    active: string
    sub: string
    description: string
  }[]
  const files = JSON.parse(
    await run('/usr/bin/systemctl', ['list-unit-files', '--type=service', '-o', 'json'])
  ) as { unit_file: string; state: string }[]
  const enabledMap = new Map(files.map((f) => [f.unit_file, f.state]))

  const loaded = units.filter((u) => u.load === 'loaded')
  const details = new Map<string, ShowBlock>()
  const interesting = loaded.filter((u) => !isBackground(u.unit)).map((u) => u.unit)
  if (interesting.length) {
    const out = await run('/usr/bin/systemctl', [
      'show',
      '-p',
      'Id,ActiveEnterTimestamp,MainPID,MemoryCurrent',
      ...interesting,
    ])
    for (const b of parseShow(out)) details.set(b.Id, b)
  }

  return loaded
    .map((u) => {
      const d = details.get(u.unit)
      const mem = Number(d?.MemoryCurrent)
      const pid = Number(d?.MainPID)
      const ctl = CONTROLLABLE[u.unit]
      return {
        unit: u.unit,
        description: u.description,
        load: u.load,
        active: u.active,
        sub: u.sub,
        enabled: enabledMap.get(u.unit) ?? null,
        since: u.active === 'active' ? tsOf(d?.ActiveEnterTimestamp) : null,
        mainPid: pid > 0 ? pid : null,
        memory: Number.isFinite(mem) && mem > 0 && mem < 2 ** 60 ? mem : null,
        background: isBackground(u.unit),
        controllable: Boolean(ctl),
        warning: ctl?.warning,
      }
    })
    .sort((a, b) => Number(a.background) - Number(b.background) || a.unit.localeCompare(b.unit))
}

export async function controlUnit(unit: string, action: UnitAction) {
  if (!CONTROLLABLE[unit]) throw new Error('служба не в списке разрешённых')
  if (!ACTIONS.includes(action)) throw new Error('недопустимое действие')
  await sudo(['/usr/bin/systemctl', action, unit], { timeoutMs: 60_000 })
}

export async function failedUnits(): Promise<string[]> {
  const units = JSON.parse(await run('/usr/bin/systemctl', ['list-units', '--failed', '-o', 'json'])) as { unit: string }[]
  return units.map((u) => u.unit)
}

// Автозагрузка: enabled-юниты + контейнеры с restart policy
export async function listAutostart() {
  const files = JSON.parse(
    await run('/usr/bin/systemctl', ['list-unit-files', '--state=enabled', '-o', 'json'])
  ) as { unit_file: string; state: string; preset: string | null }[]
  const units = files
    .filter((f) => /\.(service|timer|socket|path|mount)$/.test(f.unit_file) && !f.unit_file.includes('@.'))
    .map((f) => ({ unit: f.unit_file, type: f.unit_file.split('.').pop()!, preset: f.preset, background: isBackground(f.unit_file) }))

  let containers: { name: string; image: string; restart: string; state: string }[] | null = null
  try {
    containers = (await listContainers(false)).map((c) => ({ name: c.name, image: c.image, restart: c.restartPolicy ?? 'no', state: c.state }))
  } catch {
    containers = null // docker-socket-proxy недоступен — «нет данных»
  }
  return { units, containers }
}
