import { sudo } from '../exec.js'

// Точки монтирования, которыми можно управлять из панели (только съёмные диски из fstab с nofail).
// Системный / сюда не входит. Команды для sudo — ровно такие же, как в deploy/sudoers-server-panel.
export const MOUNTABLE = ['/mnt/hdd1tb', '/mnt/uploads1', '/mnt/uploads2'] as const
export type MountAction = 'mount' | 'remount'

// mount: монтирование по записи fstab (по UUID), когда диск отвалился или не смонтирован.
// remount: зависшее монтирование (диск отвечает ошибками I/O) сначала отцепляется ленивым umount,
//          затем монтируется заново.
export async function runMountAction(mount: string, action: MountAction) {
  if (!(MOUNTABLE as readonly string[]).includes(mount)) throw new Error('точка монтирования не в белом списке')
  if (action === 'remount') await sudo(['/usr/bin/umount', '-l', mount], { timeoutMs: 60_000 })
  await sudo(['/usr/bin/mount', mount], { timeoutMs: 60_000 })
}
