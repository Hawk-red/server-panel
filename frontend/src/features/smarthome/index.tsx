import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderPlus, KeyRound, Lightbulb, Plug, Plus, RefreshCw, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useLinks } from '@/lib/links'
import {
  DEFAULT_ROOMS, type DeviceForm, devicesByGroup, emptyForm, EXAMPLES, groupBlockId, groupLayoutPage, HA_STATUS_TEXT, MAX_DEVICES, type Group,
  type SmartDevice, type SmartHomeData, SMARTHOME_LAYOUT_PAGE, summaryText, toForm,
} from '@/lib/smarthome'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Page } from '@/components/layout/page'
import { useLayoutEdit } from '@/components/layout/layout-edit'
import { type Block, SortableBlocks } from '@/components/sortable-blocks'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { type CardActions, HiddenRow } from './device-card'
import { DeviceDialog } from './device-dialog'
import { MoveDialog, NameDialog } from './dialogs'
import { GroupSection } from './group-section'
import { apiError } from './icons'

const COLLAPSE_KEY = 'smarthome.collapsed'
const readCollapsed = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

// ---------- подключение Home Assistant ----------
function HaNotice({ ha, onSync, syncing }: { ha: SmartHomeData['ha']; onSync: () => void; syncing: boolean }) {
  if (!ha.configured) {
    return (
      <Card className='border-info/40 bg-info/5'>
        <CardContent className='space-y-3 px-5'>
          <div className='flex items-center gap-2 font-medium'>
            <KeyRound className='size-4 text-info' /> Подключите Home Assistant
          </div>
          <p className='text-sm text-muted-foreground'>Панель покажет устройства из Home Assistant (только чтение, без управления). Нужен долгосрочный токен доступа:</p>
          <ol className='list-decimal space-y-1 ps-5 text-sm'>
            <li>В Home Assistant откройте профиль (внизу слева) → «Безопасность» → «Долгосрочные токены доступа» → «Создать токен».</li>
            <li>
              На сервере, в обычном терминале, выполните (токен вводится скрыто):
              <pre className='mt-1.5 overflow-x-auto rounded bg-muted px-2 py-1.5 text-xs'>sudo -u panel node /opt/server-panel/backend/dist/scripts/set-secret.js HA_TOKEN</pre>
              Токен сохранится в <code className='text-xs'>/opt/server-panel/backend/.env</code>.
            </li>
            <li>
              Перезапустите панель: <code className='text-xs'>sudo systemctl restart server-panel</code>
            </li>
          </ol>
          <p className='text-xs text-muted-foreground'>Пока токена нет, устройства можно добавлять вручную.</p>
        </CardContent>
      </Card>
    )
  }
  const bad = ha.status !== 'ok' && ha.status !== 'pending'
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm', bad ? 'border-warn/40 bg-warn/5' : 'text-muted-foreground')} role='status'>
      {bad ? <TriangleAlert className='size-4 shrink-0 text-warn' /> : <Plug className='size-4 shrink-0' />}
      <span className={cn(bad && 'text-foreground')}>
        {ha.status === 'pending'
          ? 'Home Assistant: загружаю…'
          : bad
            ? `${HA_STATUS_TEXT[ha.status as keyof typeof HA_STATUS_TEXT]}${ha.message && !ha.message.startsWith(HA_STATUS_TEXT[ha.status as keyof typeof HA_STATUS_TEXT]) ? `: ${ha.message}` : ''}. Показаны последние известные данные.`
            : `Home Assistant: обновлено ${ha.syncedAt ? new Date(ha.syncedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}`}
      </span>
      <Button size='sm' variant='ghost' className='ms-auto' onClick={onSync} disabled={syncing}>
        <RefreshCw className={cn(syncing && 'animate-spin')} /> Обновить
      </Button>
    </div>
  )
}

// ---------- содержимое страницы (внутри Page: нужен режим изменения порядка) ----------
type Level = 'groups' | 'cards'

function Content({ data, actions, onAdd, onRenameGroup, onDeleteGroup, onShow, onSync, syncing }: {
  data: SmartHomeData
  actions: CardActions
  onAdd: (f?: Partial<DeviceForm>) => void
  onRenameGroup: (g: Group) => void
  onDeleteGroup: (g: Group) => void
  onShow: (d: SmartDevice) => void
  onSync: () => void
  syncing: boolean
}) {
  const qc = useQueryClient()
  const edit = useLayoutEdit()
  const editing = Boolean(edit?.editing)
  const [level, setLevel] = useState<Level>('groups')
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed)
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const next = c.includes(id) ? c.filter((x) => x !== id) : [...c, id]
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next))
      } catch {
        /* без хранилища просто не запоминаем */
      }
      return next
    })

  const reset = useMutation({
    mutationFn: async () => {
      const pages = level === 'groups' ? [SMARTHOME_LAYOUT_PAGE] : data.groups.map((g) => groupLayoutPage(g.id))
      await Promise.all(pages.map((p) => api.put(`/layout/${p}`, { order: [] })))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['layout'] })
      toast.success(level === 'groups' ? 'Порядок групп сброшен' : 'Порядок карточек сброшен')
    },
    onError: () => toast.error('Не удалось сбросить порядок'),
  })

  const byGroup = devicesByGroup(data.devices, data.groups)
  const none = data.devices.length === 0

  const groupBlocks: Block[] = data.groups.map((g) => ({
    id: groupBlockId(g.id),
    title: g.name,
    node: (
      <GroupSection group={g} devices={byGroup.get(g.id) ?? []} collapsed={collapsed.includes(g.id)} onToggle={() => toggle(g.id)} compact={editing && level === 'groups'} cardsSortable={editing && level === 'cards'}
        actions={actions} onRename={onRenameGroup} onDelete={onDeleteGroup} />
    ),
  }))

  return (
    <div className='space-y-4'>
      <HaNotice ha={data.ha} onSync={onSync} syncing={syncing} />

      {editing && edit && (
        <div className='flex flex-wrap items-center gap-2 rounded-lg border border-info/50 bg-info/10 px-3 py-2 text-sm'>
          <div className='inline-flex rounded-md border bg-background p-0.5' role='tablist' aria-label='Что переставлять'>
            {([['groups', 'Порядок групп'], ['cards', 'Порядок карточек']] as const).map(([id, label]) => (
              <button key={id} type='button' role='tab' aria-selected={level === id} onClick={() => setLevel(id)} className={cn('min-h-8 rounded px-3 text-sm', level === id ? 'bg-info/15 font-medium' : 'text-muted-foreground')}>
                {label}
              </button>
            ))}
          </div>
          <span className='me-auto text-muted-foreground'>{level === 'groups' ? 'Перетащите группу или используйте стрелки ▲▼.' : 'Перетащите карточку внутри группы. В другую группу: «⋯» → «Переместить в группу…».'}</span>
          <Button type='button' size='sm' variant='outline' onClick={() => reset.mutate()} disabled={reset.isPending}>
            Сбросить порядок
          </Button>
          <Button type='button' size='sm' onClick={() => edit.setEditing(false)}>
            Готово
          </Button>
        </div>
      )}

      {none && !editing ? (
        data.ha.status === 'pending' ? (
          <p className='text-sm text-muted-foreground'>Загружаю устройства из Home Assistant…</p>
        ) : (
          <Card className='mx-auto max-w-3xl'>
            <CardContent className='flex flex-col items-center gap-6 px-6 py-10 text-center'>
              <div className='flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground'>
                <Lightbulb className='size-8' />
              </div>
              <div className='space-y-1.5'>
                <h2 className='text-2xl font-semibold'>Добавьте первое устройство</h2>
                <p className='text-muted-foreground'>Лампы, розетки, камеры: панель покажет, какие из них сейчас в сети, и откроет их веб-интерфейс.</p>
              </div>
              <Button size='lg' onClick={() => onAdd()}>
                <Plus /> Добавить устройство
              </Button>
              <div className='grid w-full gap-3 sm:grid-cols-3'>
                {EXAMPLES.map((ex) => (
                  <button key={ex.title} type='button' onClick={() => onAdd(ex.form)} className='rounded-xl border p-4 text-left transition-colors hover:bg-muted/60'>
                    <div className='font-medium'>{ex.title}</div>
                    <div className='mt-1 text-xs text-muted-foreground'>{ex.hint}</div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )
      ) : (
        <SortableBlocks stable banner={false} sortable={editing && level === 'groups'} blocks={groupBlocks} className='grid gap-4' />
      )}

      {data.hidden.length > 0 && !editing && (
        <details className='rounded-lg border px-3 py-2'>
          <summary className='cursor-pointer text-sm text-muted-foreground'>Скрытые устройства: {data.hidden.length}</summary>
          <div className='mt-2 space-y-1.5'>
            {data.hidden.map((d) => (
              <HiddenRow key={d.id} d={d} onShow={onShow} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

export function SmartHome() {
  const qc = useQueryClient()
  const links = useLinks()
  const [dialog, setDialog] = useState<{ editing: SmartDevice | null; initial: DeviceForm; key: number } | null>(null)
  const [toDelete, setToDelete] = useState<SmartDevice | null>(null)
  const [renaming, setRenaming] = useState<SmartDevice | null>(null)
  const [moving, setMoving] = useState<SmartDevice | null>(null)
  const [newGroupFor, setNewGroupFor] = useState<{ device: SmartDevice | null } | null>(null)
  const [groupRename, setGroupRename] = useState<Group | null>(null)
  const [groupDelete, setGroupDelete] = useState<Group | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const { data, isError, isPending } = useQuery({
    queryKey: ['smarthome'],
    queryFn: async () => (await api.get<SmartHomeData>('/smarthome/devices')).data,
    // Раз в 30 с, пока вкладка открыта; пока идёт первая проверка или загрузка из HA — чаще
    refetchInterval: (q) => (q.state.data?.ha.status === 'pending' || q.state.data?.devices.some((d) => d.status.state === 'checking') ? 2000 : 30_000),
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['smarthome'] })
  const fail = (e: unknown, fallback: string) => {
    const m = apiError(e).message ?? fallback
    setFormError(m)
    toast.error(m)
  }
  const closeAll = () => {
    setRenaming(null)
    setMoving(null)
    setNewGroupFor(null)
    setGroupRename(null)
    setFormError(null)
  }

  const patch = useMutation({
    mutationFn: async (v: { id: number; body: { name?: string; groupKey?: string | null; hidden?: boolean } }) => (await api.patch(`/smarthome/devices/${v.id}`, v.body)).data,
    onSuccess: (_d, v) => {
      toast.success(v.body.hidden !== undefined ? (v.body.hidden ? 'Устройство скрыто' : 'Устройство снова на странице') : v.body.groupKey !== undefined ? 'Перемещено' : 'Сохранено')
      closeAll()
      refresh()
    },
    onError: (e) => fail(e, 'не удалось сохранить'),
  })
  const remove = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/smarthome/devices/${id}`)).data,
    onSuccess: () => {
      toast.success('Устройство удалено')
      setToDelete(null)
      refresh()
    },
    onError: (e) => {
      toast.error(apiError(e).message ?? 'не удалось удалить')
      setToDelete(null)
    },
  })
  const createGroup = useMutation({
    mutationFn: async (v: { name: string; device: SmartDevice | null }) => {
      const g = (await api.post<Group>('/smarthome/groups', { name: v.name })).data
      if (v.device) await api.patch(`/smarthome/devices/${v.device.id}`, { groupKey: g.id })
      return g
    },
    onSuccess: () => {
      toast.success('Группа создана')
      closeAll()
      refresh()
    },
    onError: (e) => fail(e, 'не удалось создать группу'),
  })
  const renameGroup = useMutation({
    mutationFn: async (v: { id: string; name: string }) => (await api.put(`/smarthome/groups/${v.id}`, { name: v.name })).data,
    onSuccess: () => {
      toast.success('Группа переименована')
      closeAll()
      refresh()
    },
    onError: (e) => fail(e, 'не удалось переименовать'),
  })
  const deleteGroup = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/smarthome/groups/${id}`)).data,
    onSuccess: () => {
      toast.success('Группа удалена, устройства вернулись в блоки по умолчанию')
      setGroupDelete(null)
      refresh()
    },
    onError: (e) => {
      toast.error(apiError(e).message ?? 'не удалось удалить группу')
      setGroupDelete(null)
    },
  })
  const sync = useMutation({
    mutationFn: async () => (await api.post<SmartHomeData>('/smarthome/ha/sync', {})).data,
    onSuccess: (d) => qc.setQueryData(['smarthome'], d),
    onError: (e) => toast.error(apiError(e).message ?? 'не удалось обновить'),
  })

  const devices = data?.devices ?? []
  const openDialog = (editing: SmartDevice | null, patchForm?: Partial<DeviceForm>) =>
    setDialog({ editing, initial: editing ? toForm(editing) : { ...emptyForm(), ...patchForm }, key: Date.now() })
  const manualCount = devices.filter((d) => d.source === 'manual').length

  const actions: CardActions = {
    onEdit: (d) => (d.source === 'manual' ? openDialog(d) : setRenaming(d)),
    onMove: (d) => {
      setFormError(null)
      setMoving(d)
    },
    onHide: (d, hidden) => patch.mutate({ id: d.id, body: { hidden } }),
    onDelete: setToDelete,
    haHref: (id) => links.href('homeassistant', `/config/devices/device/${id}`),
  }

  return (
    <Page
      title='Умный дом'
      description={data ? summaryText(devices) : isError ? 'Не удалось получить список' : 'Загружаю…'}
      layoutPage={SMARTHOME_LAYOUT_PAGE}
      actions={
        <>
          <Button variant='outline' onClick={() => { setFormError(null); setNewGroupFor({ device: null }) }}>
            <FolderPlus /> Новая группа
          </Button>
          <Button onClick={() => openDialog(null)} disabled={manualCount >= MAX_DEVICES}>
            <Plus /> Добавить устройство
          </Button>
        </>
      }
    >
      {isError && <p className='mb-4 text-sm text-danger-foreground'>Не удалось получить список устройств.</p>}
      {!isPending && !isError && data && (
        <Content data={data} actions={actions} onAdd={(f) => openDialog(null, f)} onRenameGroup={(g) => { setFormError(null); setGroupRename(g) }} onDeleteGroup={setGroupDelete}
          onShow={(d) => patch.mutate({ id: d.id, body: { hidden: false } })} onSync={() => sync.mutate()} syncing={sync.isPending} />
      )}

      {dialog && <DeviceDialog key={dialog.key} open editing={dialog.editing} initial={dialog.initial} rooms={[...new Set([...devices.map((d) => d.room ?? ''), ...DEFAULT_ROOMS])].filter(Boolean)} onClose={() => setDialog(null)} />}

      {renaming && (
        <NameDialog title='Переименовать устройство' description='Новое имя останется, даже если в Home Assistant устройство переименуют.' initial={renaming.name} max={60} confirmText='Сохранить' pending={patch.isPending} error={formError}
          onSubmit={(name) => patch.mutate({ id: renaming.id, body: { name } })} onClose={closeAll} />
      )}
      {moving && data && (
        <MoveDialog deviceName={moving.name} groups={data.groups} current={moving.groupId} pending={patch.isPending} error={formError}
          onPick={(groupId) => patch.mutate({ id: moving.id, body: { groupKey: groupId } })} onNew={() => { const device = moving; setMoving(null); setNewGroupFor({ device }) }} onClose={closeAll} />
      )}
      {newGroupFor && (
        <NameDialog title='Новая группа' description={newGroupFor.device ? `Устройство «${newGroupFor.device.name}» окажется в ней.` : 'Пустая группа появится на странице; устройства переносятся через «⋯» → «Переместить в группу…».'} initial='' label='Название группы' max={40} confirmText='Создать'
          pending={createGroup.isPending} error={formError} onSubmit={(name) => createGroup.mutate({ name, device: newGroupFor.device })} onClose={closeAll} />
      )}
      {groupRename && (
        <NameDialog title='Переименовать группу' initial={groupRename.name} label='Название группы' max={40} confirmText='Сохранить' pending={renameGroup.isPending} error={formError}
          onSubmit={(name) => renameGroup.mutate({ id: groupRename.id, name })} onClose={closeAll} />
      )}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && !remove.isPending && setToDelete(null)}
        title={`Удалить «${toDelete?.name ?? ''}»?`}
        desc={<p>{toDelete?.source === 'homeassistant' ? 'Устройства уже нет в Home Assistant, карточка уберётся из панели.' : 'Устройство исчезнет из списка панели. Само устройство не затрагивается.'}</p>}
        confirmText='Удалить'
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => toDelete && remove.mutate(toDelete.id)}
      />
      <ConfirmDialog
        open={groupDelete !== null}
        onOpenChange={(o) => !o && !deleteGroup.isPending && setGroupDelete(null)}
        title={`Удалить группу «${groupDelete?.name ?? ''}»?`}
        desc={<p>Устройства из неё не удаляются: они вернутся в блоки по умолчанию (по комнате или интеграции).</p>}
        confirmText='Удалить группу'
        destructive
        isLoading={deleteGroup.isPending}
        handleConfirm={() => groupDelete && deleteGroup.mutate(groupDelete.id)}
      />
    </Page>
  )
}
