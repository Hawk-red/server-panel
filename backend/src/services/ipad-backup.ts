// Бэкап iPad по кнопке: панель (пользователь panel) по SSH с ключом только на выполнение скрипта на MacBook.
// На MacBook ключ в authorized_keys привязан к одной команде (command="bash …/ipad-backup.sh --force"), полного shell нет.
// Скрипт не выводит прогресс в stdout (лог — на MacBook), поэтому статус — по коду возврата и времени работы.
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { config } from '../config.js'
import { killGroup, trackChild } from '../exec.js'
import { maskSecrets } from '../mask.js'

const HOST = 'hawk@macbook-pro-ha.local'
const KEY = path.join(config.dataDir, 'ssh', 'ipad_ed25519')
const KNOWN_HOSTS = path.join(config.dataDir, 'ssh', 'known_hosts')
const MAX_RUN_MS = 3 * 3600_000 // скрипт сам обрывает бэкап через 2 ч (+ 20 мин на код), это запас
const TAIL_LINES = 30

export type IpadJobStatus = 'idle' | 'running' | 'ok' | 'retry' | 'error'
export type IpadJob = {
  status: IpadJobStatus
  startedAt: number | null
  finishedAt: number | null
  exitCode: number | null
  message: string
  /** последние строки stderr ssh (предупреждения и причины), без секретов */
  tail: string[]
}

let job: IpadJob = { status: 'idle', startedAt: null, finishedAt: null, exitCode: null, message: 'Ещё не запускали с панели', tail: [] }
let child: ChildProcess | null = null

export const ipadJobState = (): IpadJob => job

// Коды возврата ipad-backup.sh: 0 — готово (или сегодня уже сделано), 75 — «повторим позже» (iPad не в сети/заблокирован, диск не смонтирован)
function describe(code: number | null, signal: NodeJS.Signals | null): { status: IpadJobStatus; message: string } {
  if (signal) return { status: 'error', message: `процесс остановлен сигналом ${signal}` }
  switch (code) {
    case 0:
      return { status: 'ok', message: 'Скрипт завершился без ошибок. Если копия уже была сделана сегодня, он ничего не копировал.' }
    case 75:
      return {
        status: 'retry',
        message: 'iPad сейчас недоступен (спит, не в Wi-Fi или не разблокирован), либо не смонтирован диск MacBook. Скрипт повторит попытку при следующем запуске. Это не ошибка.',
      }
    case 124:
      return { status: 'error', message: 'Бэкап прервался: код на iPad не ввели за 20 минут или копия шла дольше 2 часов. Подробности — в логе на MacBook (~/Library/Logs/ipad-backup.log).' }
    case 4:
      return { status: 'error', message: 'Копия неполная (нет Manifest.db или Status.plist), отмечена не как готовая. Подробности — в логе на MacBook.' }
    case 1:
      return { status: 'error', message: 'idevicebackup2 завершился с ошибкой. Подробности — в логе на MacBook.' }
    case 255:
      return { status: 'error', message: 'Нет SSH-доступа к MacBook (сеть, ключ или authorized_keys). Текст ошибки ниже.' }
    default:
      return { status: 'error', message: `скрипт завершился с кодом ${code}` }
  }
}

export function startIpadBackup(): IpadJob {
  if (child) throw Object.assign(new Error('бэкап iPad уже идёт'), { statusCode: 409 })
  const args = [
    '-i', KEY,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${KNOWN_HOSTS}`,
    '-o', 'LogLevel=ERROR',
    '-T',
    HOST,
  ]
  const startedAt = Date.now()
  job = { status: 'running', startedAt, finishedAt: null, exitCode: null, message: 'Скрипт запущен на MacBook. Прогресс смотрите там (уведомления и лог), здесь — результат.', tail: [] }
  const proc = spawn('ssh', args, { stdio: ['ignore', 'ignore', 'pipe'], detached: true })
  trackChild(proc)
  child = proc
  const errLines: string[] = []
  let buf = ''
  proc.stderr.on('data', (d: Buffer) => {
    buf += d.toString('utf8')
    const parts = buf.split('\n')
    buf = parts.pop() ?? ''
    for (const p of parts) if (p.trim()) errLines.push(maskSecrets(p.trim()).slice(0, 300))
    if (errLines.length > TAIL_LINES) errLines.splice(0, errLines.length - TAIL_LINES)
  })
  const timer = setTimeout(() => killGroup(proc, 'SIGTERM'), MAX_RUN_MS)
  proc.on('error', (e) => {
    clearTimeout(timer)
    child = null
    job = { ...job, status: 'error', finishedAt: Date.now(), exitCode: null, message: `не удалось запустить ssh: ${e.message}`, tail: errLines }
  })
  proc.on('close', (code, signal) => {
    clearTimeout(timer)
    child = null
    if (buf.trim()) errLines.push(maskSecrets(buf.trim()).slice(0, 300))
    const d = describe(code, signal)
    job = { ...job, ...d, finishedAt: Date.now(), exitCode: code, tail: errLines.slice(-TAIL_LINES) }
  })
  return job
}
