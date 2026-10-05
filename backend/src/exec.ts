import { spawn, type ChildProcess } from 'node:child_process'

export class ExecError extends Error {
  constructor(
    message: string,
    public code: number | string | null,
    public stderr: string,
    public stdout: string
  ) {
    super(message)
  }
}

// Все дочерние процессы панели живут в СВОЕЙ группе процессов (detached): по таймауту и при остановке панели убивается вся группа,
// а не один процесс. Иначе внучатые процессы (du под sudo-обёрткой, rsync, smartctl) остаются сиротами с родителем 1.
const live = new Set<ChildProcess>()

export function killGroup(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') {
  if (!child.pid) return
  try {
    process.kill(-child.pid, signal) // вся группа (лидер группы = сам процесс)
  } catch {
    try {
      child.kill(signal)
    } catch {
      /* уже завершился */
    }
  }
}

// Для мест, где процесс запускается напрямую через spawn: запись в общий реестр (остановится вместе с панелью)
export function trackChild(child: ChildProcess) {
  live.add(child)
  child.once('exit', () => live.delete(child))
  child.once('error', () => live.delete(child))
}

// При остановке панели: мягко, затем жёстко. Вызывается из shutdown и на выходе процесса
export function killAllChildren(signal: NodeJS.Signals = 'SIGTERM') {
  for (const c of live) killGroup(c, signal)
}
process.on('exit', () => killAllChildren('SIGKILL'))

type Opts = { timeoutMs?: number; maxBuffer?: number; input?: string }
type Result = { code: number | string | null; stdout: string; stderr: string; timedOut: boolean; overflow: boolean }

const KILL_GRACE_MS = 3000

function exec(cmd: string, args: string[], opts: Opts): Promise<Result> {
  return new Promise((resolve) => {
    const timeoutMs = opts.timeoutMs ?? 10_000
    const maxBuffer = opts.maxBuffer ?? 8 * 1024 * 1024
    let child: ChildProcess
    try {
      child = spawn(cmd, args, { detached: true, stdio: [opts.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } })
    } catch (e) {
      return resolve({ code: (e as NodeJS.ErrnoException).code ?? null, stdout: '', stderr: (e as Error).message, timedOut: false, overflow: false })
    }
    trackChild(child)
    let stdout = ''
    let stderr = ''
    let size = 0
    let done = false
    let timedOut = false
    let overflow = false
    const finish = (code: number | string | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut, overflow })
    }
    // Убить всю группу: сначала SIGTERM, через паузу SIGKILL, если что-то не завершилось
    const kill = () => {
      killGroup(child, 'SIGTERM')
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) killGroup(child, 'SIGKILL')
      }, KILL_GRACE_MS).unref()
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill()
      // процесс в «D»-состоянии (зависший диск) может не отвечать на сигналы: не ждём его, вызывающий получает ошибку по таймауту
      finish('ETIMEDOUT')
    }, timeoutMs)
    const onData = (kind: 'out' | 'err') => (d: Buffer) => {
      size += d.length
      if (size > maxBuffer) {
        if (!overflow) {
          overflow = true
          kill()
          finish('ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
        }
        return
      }
      if (kind === 'out') stdout += d.toString('utf8')
      else stderr += d.toString('utf8')
    }
    child.stdout?.on('data', onData('out'))
    child.stderr?.on('data', onData('err'))
    child.on('error', (e) => {
      stderr += (e as Error).message
      finish((e as NodeJS.ErrnoException).code ?? null)
    })
    child.on('close', (code) => finish(code))
    if (opts.input !== undefined) {
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(opts.input)
    }
  })
}

// Запуск внешней команды без shell, с таймаутом и ограничением вывода; по таймауту убивается вся группа процессов
export async function run(cmd: string, args: string[], opts: Opts = {}): Promise<string> {
  const r = await exec(cmd, args, opts)
  if (r.code === 0) return r.stdout
  const why = r.timedOut ? `превышено время ожидания (${(opts.timeoutMs ?? 10_000) / 1000} с)` : r.overflow ? 'вывод команды слишком большой' : `Command failed: ${cmd} ${args.join(' ')}`
  throw new ExecError(r.stderr.trim() || why, r.code, r.stderr, r.stdout)
}

// sudo -n: без пароля, только команды из /etc/sudoers.d/server-panel
export function sudo(args: string[], opts?: Opts) {
  return run('/usr/bin/sudo', ['-n', ...args], opts)
}

// Для утилит, которые печатают версию в stderr (nginx -v)
export async function runMerged(cmd: string, args: string[], timeoutMs = 5000): Promise<string> {
  const r = await exec(cmd, args, { timeoutMs })
  return `${r.stdout}${r.stderr}`
}
