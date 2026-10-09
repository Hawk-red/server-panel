// Управление обновлением контейнеров через root-помощника. Этап A: только показ — ни один контейнер не подключён.
export type ManagedInfo = {
  managed: boolean
  danger: boolean
  warning: string | null
  rollback: { version: string | null; at: number } | null
}

export async function managedInfo(_container: string): Promise<ManagedInfo> {
  return { managed: false, danger: false, warning: null, rollback: null }
}
