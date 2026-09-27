import { execFile } from 'node:child_process'

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

// Запуск внешней команды без shell, с таймаутом и ограничением вывода
export function run(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; maxBuffer?: number } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeoutMs ?? 10_000, maxBuffer: opts.maxBuffer ?? 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException & { code?: number | string }).code ?? null
          reject(new ExecError(stderr.trim() || error.message, code, stderr, stdout))
        } else resolve(stdout)
      }
    )
  })
}

// sudo -n: без пароля, только команды из /etc/sudoers.d/server-panel
export function sudo(args: string[], opts?: { timeoutMs?: number; maxBuffer?: number }) {
  return run('/usr/bin/sudo', ['-n', ...args], opts)
}

// Для утилит, которые печатают версию в stderr (nginx -v)
export function runMerged(cmd: string, args: string[], timeoutMs = 5000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, env: { ...process.env, LC_ALL: 'C' } }, (_e, stdout, stderr) => resolve(`${stdout}${stderr}`))
  })
}
