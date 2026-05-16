import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import {
  appendTaskImages,
  createHubTask,
  deleteHubTask,
  notifyTaskAssignedPush,
  fetchHasPendingHubTasksBefore,
  fetchHubProfileDisplayNames,
  fetchHubTasksCompleted,
  fetchHubTasksPending,
  signedImageUrl,
  updateHubTaskExecuted,
} from '../lib/hubTasksApi'
import { formatSupabaseOrError } from '../lib/errors'
import { addDaysToIsoDate, formatDayMonthShort, normalizeCalendarDate, todayIsoLocal } from '../lib/date'
import { supabase } from '../lib/supabase'
import type { HubImportance, HubUserRole, NmHubTask } from '../lib/types'
import { HubBrandBar } from './HubBrandBar'
import { HubPushNotificationSetup } from './HubPushNotificationSetup'
import { HUB_NAV_EVENT } from '../lib/hubNavigate'
import {
  getTaskAssigneeRolesForCreator,
  HUB_TASK_ASSIGNEE_LABEL,
  type HubTaskAssignableRole,
} from '../lib/hubTaskAssignable'

const IMPORTANCE_LABEL: Record<HubImportance, string> = {
  low: 'Baja',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
}

/** Borde izquierdo de tarjeta (prioridad). */
const PRIORITY_ACCENT: Record<HubImportance, string> = {
  low: '#a1a9b6',
  normal: '#46cff8',
  high: '#ffab40',
  urgent: '#fb7185',
}

const IMPORTANCE_ORDER: HubImportance[] = ['low', 'normal', 'high', 'urgent']

/** Importancia con menú HTML (select nativo en Windows muestra lista clara del SO). */
function ImportanceSelect({
  id,
  value,
  onChange,
  disabled = false,
}: {
  id: string
  value: HubImportance
  onChange: (v: HubImportance) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const select = (k: HubImportance) => {
    onChange(k)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="importance-dropdown">
      <button
        type="button"
        id={id}
        className="importance-dropdown__trigger nm-hub-input field-select"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span className="importance-dropdown__value">{IMPORTANCE_LABEL[value]}</span>
        <svg
          className="importance-dropdown__chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div
          id={`${id}-listbox`}
          className="importance-dropdown__panel"
          role="listbox"
          aria-labelledby={id}
        >
          {IMPORTANCE_ORDER.map((k) => (
            <button
              key={k}
              type="button"
              role="option"
              aria-selected={value === k}
              className={`importance-dropdown__option importance-dropdown__option--${k}`}
              onClick={() => select(k)}
            >
              {IMPORTANCE_LABEL[k]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function AssigneeRoleSelect({
  id,
  value,
  onChange,
  roles,
  disabled = false,
}: {
  id: string
  value: HubTaskAssignableRole | null
  onChange: (v: HubTaskAssignableRole) => void
  roles: readonly HubTaskAssignableRole[]
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const select = (k: HubTaskAssignableRole) => {
    onChange(k)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="importance-dropdown assignee-dropdown">
      <button
        type="button"
        id={id}
        className="importance-dropdown__trigger nm-hub-input field-select"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-assignee-listbox`}
        aria-invalid={value === null && !disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span
          className={`importance-dropdown__value${value ? '' : ' importance-dropdown__value--placeholder'}`}
        >
          {value ? HUB_TASK_ASSIGNEE_LABEL[value] : 'Elegí a quién va'}
        </span>
        <svg
          className="importance-dropdown__chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div
          id={`${id}-assignee-listbox`}
          className="importance-dropdown__panel"
          role="listbox"
          aria-labelledby={id}
        >
          {roles.map((k) => (
            <button
              key={k}
              type="button"
              role="option"
              aria-selected={value === k}
              className="importance-dropdown__option"
              onClick={() => select(k)}
            >
              {HUB_TASK_ASSIGNEE_LABEL[k]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

type TasksPanel = 'list' | 'create'
type HubListScope = 'inbox' | 'sent' | 'completadas'

function readHubListScope(): HubListScope {
  if (typeof window === 'undefined') return 'inbox'
  const hub = new URLSearchParams(window.location.search).get('hub')
  if (hub === 'completadas') return 'completadas'
  if (hub === 'asignadas' || hub === 'seguimiento') return 'sent'
  /** Compatibilidad con enlaces viejos `hub=pendientes`. */
  if (hub === 'pendientes') return 'inbox'
  return 'inbox'
}

/** Tareas que creé y asigné a otro rol (pestaña Asignadas). */
function isDelegatedByMe(t: NmHubTask, myRole: HubUserRole, myId: string): boolean {
  if (t.created_by !== myId) return false
  return t.assigned_role !== myRole
}

/** Bandeja «Mis tareas»: solo lo asignado a mi rol (incl. admin → assigned_role admin). */
function taskInAssignedInbox(t: NmHubTask, myRole: HubUserRole): boolean {
  return t.assigned_role === myRole
}
/** Hash explícito gana; si no hay hash útil, `?hub=crear` (desde inicio) abre el formulario aunque el fragmento se pierda. */
function hubTasksPanelFromLocation(readOnly: boolean): TasksPanel {
  if (readOnly) return 'list'
  if (typeof window === 'undefined') return 'list'
  const hash = window.location.hash || ''
  const id = hash.replace(/^#/, '')
  if (id === 'nm-hub-tareas-nueva') return 'create'
  if (id === 'nm-hub-tareas-lista') return 'list'
  const hub = new URLSearchParams(window.location.search).get('hub')
  if (hub === 'crear') return 'create'
  return 'list'
}

function normalizeTasksPathname(): string {
  let p = (window.location.pathname || '/').toLowerCase()
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}

function readDayFromUrl(): string {
  if (typeof window === 'undefined') return ''
  const d = normalizeCalendarDate(new URLSearchParams(window.location.search).get('d'))
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ''
}

function replaceUrlPreservingQuery(hash: string) {
  if (typeof window === 'undefined') return
  const u = new URL(window.location.href)
  u.hash = hash.startsWith('#') ? hash : `#${hash}`
  window.history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`)
}

function replaceCreatePanelUrl() {
  if (typeof window === 'undefined') return
  const u = new URL(window.location.href)
  u.searchParams.set('hub', 'crear')
  u.hash = '#nm-hub-tareas-nueva'
  window.history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`)
  window.dispatchEvent(new CustomEvent(HUB_NAV_EVENT))
}

function replaceListPanelUrl() {
  if (typeof window === 'undefined') return
  const u = new URL(window.location.href)
  u.searchParams.delete('hub')
  u.hash = '#nm-hub-tareas-lista'
  window.history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`)
  window.dispatchEvent(new CustomEvent(HUB_NAV_EVENT))
}

function setListScopeInUrl(scope: HubListScope) {
  if (typeof window === 'undefined') return
  const u = new URL(window.location.href)
  if (scope === 'completadas') {
    u.searchParams.set('hub', 'completadas')
  } else if (scope === 'sent') {
    u.searchParams.set('hub', 'asignadas')
  } else {
    u.searchParams.delete('hub')
  }
  if (!u.hash || u.hash === '#') u.hash = '#nm-hub-tareas-lista'
  window.history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`)
  window.dispatchEvent(new CustomEvent(HUB_NAV_EVENT))
}

function importanceRank(i: HubImportance): number {
  switch (i) {
    case 'urgent':
      return 4
    case 'high':
      return 3
    case 'normal':
      return 2
    default:
      return 1
  }
}

function sortPendingTasks(list: NmHubTask[]): NmHubTask[] {
  return [...list].sort((a, b) => {
    const ir = importanceRank(b.importance) - importanceRank(a.importance)
    if (ir !== 0) return ir
    return Date.parse(b.created_at) - Date.parse(a.created_at)
  })
}

/** Urgente primero; a igual importancia, la más recientemente completada arriba. */
function sortCompletedTasks(list: NmHubTask[]): NmHubTask[] {
  return [...list].sort((a, b) => {
    const ir = importanceRank(b.importance) - importanceRank(a.importance)
    if (ir !== 0) return ir
    const ea = a.executed_at ? Date.parse(a.executed_at) : 0
    const eb = b.executed_at ? Date.parse(b.executed_at) : 0
    return eb - ea
  })
}

/** Asignadas: pendientes arriba; completadas por el destinatario abajo. */
function sortAssignedByMeTasks(list: NmHubTask[]): NmHubTask[] {
  return [...list].sort((a, b) => {
    const aDone = Boolean(a.executed_at)
    const bDone = Boolean(b.executed_at)
    if (aDone !== bDone) return aDone ? 1 : -1
    if (aDone && bDone) {
      const eb = b.executed_at ? Date.parse(b.executed_at) : 0
      const ea = a.executed_at ? Date.parse(a.executed_at) : 0
      if (eb !== ea) return eb - ea
    }
    const ir = importanceRank(b.importance) - importanceRank(a.importance)
    if (ir !== 0) return ir
    return Date.parse(b.created_at) - Date.parse(a.created_at)
  })
}

function formatExecutedLabel(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function HubImageLightbox({
  src,
  onClose,
}: {
  src: string
  onClose: () => void
}) {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    setScale(1)
  }, [src])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="nm-hub-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Vista previa de imagen"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="nm-hub-lightbox__toolbar">
        <div className="nm-hub-lightbox__zoom">
          <button type="button" className="nm-hub-btn nm-hub-btn-ghost nm-hub-lightbox__tool" onClick={() => setScale((s) => Math.min(3, s + 0.25))} aria-label="Acercar">
            +
          </button>
          <button type="button" className="nm-hub-btn nm-hub-btn-ghost nm-hub-lightbox__tool" onClick={() => setScale((s) => Math.max(0.5, s - 0.25))} aria-label="Alejar">
            −
          </button>
          <button type="button" className="nm-hub-btn nm-hub-btn-ghost nm-hub-lightbox__tool" onClick={() => setScale(1)} aria-label="Tamaño original">
            1:1
          </button>
        </div>
        <button type="button" className="nm-hub-btn nm-hub-btn-primary nm-hub-lightbox__close" onClick={onClose}>
          Cerrar
        </button>
      </div>
      <div className="nm-hub-lightbox__stage">
        <img
          src={src}
          alt=""
          className="nm-hub-lightbox__img"
          style={{ transform: `scale(${scale})` }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  )
}

function TaskThumbnails({ paths, rebel = false }: { paths: string[]; rebel?: boolean }) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [lightbox, setLightbox] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const next: Record<string, string> = {}
      for (const p of paths) {
        const u = await signedImageUrl(p)
        if (u) next[p] = u
      }
      if (!cancelled) setUrls(next)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [paths])

  if (paths.length === 0) return null
  const wrapCls = rebel ? 'task-media-attachment' : 'nm-hub-task-images'
  const btnCls = rebel ? 'task-thumb-hit' : 'nm-hub-thumb-btn'
  const imgCls = rebel ? 'task-thumb-rebel' : 'nm-hub-thumb'

  return (
    <>
      <div className={wrapCls}>
        {paths.map((p) =>
          urls[p] ? (
            <button
              key={p}
              type="button"
              className={btnCls}
              onClick={() => setLightbox(urls[p])}
              aria-label="Ampliar imagen"
            >
              <img src={urls[p]} alt="" className={imgCls} />
            </button>
          ) : (
            <span key={p} className="nm-hub-thumb-placeholder" aria-hidden />
          ),
        )}
      </div>
      {lightbox ? <HubImageLightbox src={lightbox} onClose={() => setLightbox(null)} /> : null}
    </>
  )
}

export type HubTasksAppProps = {
  readOnly?: boolean
  profileRole: HubUserRole
  profileId: string
  isAdmin: boolean
  /** Pestaña «Asignadas» (delegadas por mí); útil cuando `createHubTasks`. */
  showSentTab?: boolean
}

export function HubTasksApp({
  readOnly = false,
  profileRole,
  profileId,
  isAdmin,
  showSentTab = true,
}: HubTasksAppProps) {
  const [rawPending, setRawPending] = useState<NmHubTask[]>([])
  const [rawCompleted, setRawCompleted] = useState<NmHubTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [listScope, setListScope] = useState<HubListScope>(() =>
    typeof window !== 'undefined' ? readHubListScope() : 'inbox',
  )
  const [hasOlderPending, setHasOlderPending] = useState(false)
  const [executorNames, setExecutorNames] = useState<Record<string, string>>({})
  const [taskQuery, setTaskQuery] = useState('')
  const [pendingDeleteTask, setPendingDeleteTask] = useState<NmHubTask | null>(null)

  const [hubDataGen, setHubDataGen] = useState(0)
  useEffect(() => {
    const bump = () => {
      let p = (window.location.pathname || '/').toLowerCase()
      if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
      if (p === '/tareas') setHubDataGen((g) => g + 1)
    }
    window.addEventListener(HUB_NAV_EVENT, bump as EventListener)
    return () => window.removeEventListener(HUB_NAV_EVENT, bump as EventListener)
  }, [])

  const [panel, setPanel] = useState<TasksPanel>(() =>
    typeof window !== 'undefined' ? hubTasksPanelFromLocation(readOnly) : 'list',
  )

  const [taskDay, setTaskDay] = useState(() =>
    typeof window !== 'undefined' ? readDayFromUrl() || todayIsoLocal() : todayIsoLocal(),
  )

  const applyTaskDay = useCallback((next: string) => {
    const d = normalizeCalendarDate(next)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return
    setTaskDay(d)
    const u = new URL(window.location.href)
    u.searchParams.set('d', d)
    window.history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`)
  }, [])

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [importance, setImportance] = useState<HubImportance>('normal')
  const [assignedRoleCreate, setAssignedRoleCreate] = useState<HubTaskAssignableRole | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const taskGalleryInputRef = useRef<HTMLInputElement>(null)
  const taskCameraInputRef = useRef<HTMLInputElement>(null)
  /** Evita que un fetch viejo pise tareas nuevas (realtime + mutación simultánea). */
  const tasksLoadSeqRef = useRef(0)
  const hubTasksRealtimeDebounceRef = useRef<number | null>(null)
  /** Tras completar/crear en este cliente, ignorar realtime breve (ya hay patch local). */
  const suppressHubRealtimeUntilRef = useRef(0)

  const markLocalHubMutation = useCallback(() => {
    suppressHubRealtimeUntilRef.current = Date.now() + 900
  }, [])

  const appendTaskFilesFromInput = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files ? Array.from(e.target.files) : []
    if (picked.length > 0) setFiles((prev) => [...prev, ...picked])
    e.target.value = ''
  }, [])

  const refreshOlderPending = useCallback(async () => {
    try {
      const v = await fetchHasPendingHubTasksBefore(taskDay)
      setHasOlderPending(v)
    } catch {
      setHasOlderPending(false)
    }
  }, [taskDay])

  const loadSilent = useCallback(async () => {
    const day = taskDay
    const seq = ++tasksLoadSeqRef.current
    const scope = readHubListScope()
    const [pendingRows, completedRows] = await Promise.all([
      fetchHubTasksPending(day),
      fetchHubTasksCompleted(day),
    ])
    if (seq !== tasksLoadSeqRef.current) return
    setListScope(scope)
    setRawPending(pendingRows)
    setRawCompleted(completedRows)
    if (scope === 'completadas' || scope === 'sent') {
      const ids = completedRows
        .filter((t) => {
          if (!t.executed_by) return false
          if (scope === 'sent') return isDelegatedByMe(t, profileRole, profileId)
          return true
        })
        .map((t) => t.executed_by as string)
      const names = await fetchHubProfileDisplayNames(ids)
      if (seq !== tasksLoadSeqRef.current) return
      setExecutorNames(names)
    } else {
      setExecutorNames({})
    }
  }, [taskDay, hubDataGen, profileRole, profileId])

  const load = useCallback(async () => {
    setError(null)
    await loadSilent()
  }, [loadSilent])

  useEffect(() => {
    if (hubTasksPanelFromLocation(readOnly) === 'create') {
      return
    }
    let cancelled = false
    setLoading(true)
    load()
      .catch((e: unknown) => {
        if (!cancelled) setError(formatSupabaseOrError(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [load, readOnly])

  useEffect(() => {
    const sb = supabase
    if (!sb) return
    const day = normalizeCalendarDate(taskDay)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return

    const hubChangeAffectsDay = (payload: { new: Record<string, unknown>; old: Record<string, unknown> }) => {
      const fromRow = (row: Record<string, unknown> | undefined) => {
        const fd = normalizeCalendarDate(row?.for_date as string | undefined)
        return /^\d{4}-\d{2}-\d{2}$/.test(fd) ? fd : ''
      }
      const n = fromRow(payload.new)
      const o = fromRow(payload.old)
      return n === day || o === day
    }

    const scheduleSyncFromServer = () => {
      if (Date.now() < suppressHubRealtimeUntilRef.current) return
      if (hubTasksRealtimeDebounceRef.current !== null) {
        window.clearTimeout(hubTasksRealtimeDebounceRef.current)
      }
      hubTasksRealtimeDebounceRef.current = window.setTimeout(() => {
        hubTasksRealtimeDebounceRef.current = null
        void loadSilent().catch(() => {})
        if (panel !== 'create') void refreshOlderPending()
      }, 150)
    }

    const channel = sb
      .channel(`nm_hub_tasks:${day}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'nm_hub_tasks' },
        (payload) => {
          if (!hubChangeAffectsDay(payload)) return
          scheduleSyncFromServer()
        },
      )
      .subscribe()

    return () => {
      if (hubTasksRealtimeDebounceRef.current !== null) {
        window.clearTimeout(hubTasksRealtimeDebounceRef.current)
        hubTasksRealtimeDebounceRef.current = null
      }
      void sb.removeChannel(channel)
    }
  }, [taskDay, loadSilent, panel, refreshOlderPending])

  useEffect(() => {
    if (panel === 'create') {
      setHasOlderPending(false)
      return
    }
    void refreshOlderPending()
  }, [taskDay, rawPending, panel, refreshOlderPending])

  useEffect(() => {
    const u = new URL(window.location.href)
    const raw = u.searchParams.get('d')
    const d = normalizeCalendarDate(raw)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      u.searchParams.set('d', taskDay)
      window.history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`)
    }
  }, [taskDay])

  useEffect(() => {
    const onPop = () => {
      const d = readDayFromUrl() || todayIsoLocal()
      setTaskDay(d)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const syncUrlToState = useCallback(() => {
    if (normalizeTasksPathname() !== '/tareas') return

    if (readOnly) {
      setPanel('list')
      return
    }

    let hash = window.location.hash
    const resolved = hubTasksPanelFromLocation(false)

    if (!hash || hash === '#') {
      if (resolved === 'create') {
        replaceUrlPreservingQuery('#nm-hub-tareas-nueva')
      } else {
        replaceUrlPreservingQuery('#nm-hub-tareas-lista')
      }
    }

    setPanel(hubTasksPanelFromLocation(readOnly))
    setListScope(readHubListScope())
  }, [readOnly])

  useEffect(() => {
    syncUrlToState()
    window.addEventListener('hashchange', syncUrlToState)
    window.addEventListener('popstate', syncUrlToState)
    window.addEventListener(HUB_NAV_EVENT, syncUrlToState as EventListener)
    return () => {
      window.removeEventListener('hashchange', syncUrlToState)
      window.removeEventListener('popstate', syncUrlToState)
      window.removeEventListener(HUB_NAV_EVENT, syncUrlToState as EventListener)
    }
  }, [syncUrlToState])

  const assigneeRolesCreate = useMemo(() => getTaskAssigneeRolesForCreator(isAdmin), [isAdmin])

  const inboxPendingTasks = useMemo(
    () => rawPending.filter((t) => !t.executed_at && taskInAssignedInbox(t, profileRole)),
    [rawPending, profileRole],
  )
  /** Tareas que asigné a otro rol (pendientes y completadas por el destinatario). */
  const assignedByMeTasks = useMemo(() => {
    const pending = rawPending.filter((t) => isDelegatedByMe(t, profileRole, profileId))
    const completed = rawCompleted.filter((t) => isDelegatedByMe(t, profileRole, profileId))
    return [...pending, ...completed]
  }, [rawPending, rawCompleted, profileRole, profileId])

  /** Completadas: solo las de mi bandeja (rol asignado a mí), no las que delegué. */
  const mergedCompletedTasks = useMemo(
    () =>
      rawCompleted.filter((t) => {
        if (!t.executed_at) return false
        if (isDelegatedByMe(t, profileRole, profileId)) return false
        return taskInAssignedInbox(t, profileRole)
      }),
    [rawCompleted, profileRole, profileId],
  )

  const scopedForSorting = useMemo(() => {
    if (listScope === 'completadas') return mergedCompletedTasks
    if (listScope === 'sent') return assignedByMeTasks
    return inboxPendingTasks
  }, [listScope, mergedCompletedTasks, assignedByMeTasks, inboxPendingTasks])

  const sorted = useMemo(() => {
    if (listScope === 'completadas') return sortCompletedTasks(scopedForSorting)
    if (listScope === 'sent') return sortAssignedByMeTasks(scopedForSorting)
    return sortPendingTasks(scopedForSorting)
  }, [scopedForSorting, listScope])

  const filteredSorted = useMemo(() => {
    const q = taskQuery.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((t) => {
      const title = (t.title ?? '').toLowerCase()
      const body = (t.body ?? '').toLowerCase()
      return title.includes(q) || body.includes(q)
    })
  }, [sorted, taskQuery])

  const canToggleExecuted = useCallback(
    (t: NmHubTask) => {
      if (readOnly) return false
      if (isAdmin) return true
      if (listScope === 'sent') return false
      return taskInAssignedInbox(t, profileRole)
    },
    [readOnly, isAdmin, listScope, profileRole],
  )

  const canMarkComplete = useCallback(
    (t: NmHubTask) => {
      if (readOnly || t.executed_at) return false
      if (listScope === 'sent') return false
      return canToggleExecuted(t)
    },
    [readOnly, listScope, canToggleExecuted],
  )

  const canUndoComplete = useCallback(
    (t: NmHubTask) => {
      if (readOnly || !t.executed_at) return false
      if (listScope === 'sent') return isDelegatedByMe(t, profileRole, profileId)
      if (listScope === 'completadas') return canToggleExecuted(t)
      return false
    },
    [readOnly, listScope, profileRole, profileId, canToggleExecuted],
  )

  useEffect(() => {
    setTaskQuery('')
  }, [taskDay, listScope])

  const goCreatePanel = useCallback(() => {
    if (readOnly) return
    replaceCreatePanelUrl()
    setPanel('create')
  }, [readOnly])

  const goListPanel = useCallback(() => {
    replaceListPanelUrl()
    setPanel('list')
  }, [])

  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (readOnly || !title.trim() || assignedRoleCreate === null) return
    setBusy(true)
    setError(null)
    const titleDraft = title.trim()
    try {
      const created = await createHubTask({
        title: titleDraft,
        body: body.trim() || null,
        importance,
        for_date: taskDay,
        assigned_role: assignedRoleCreate,
      })
      if (files.length > 0) {
        await appendTaskImages(created.id, files, created.image_paths ?? [])
      }
      void notifyTaskAssignedPush(created)
      setTitle('')
      setBody('')
      setImportance('normal')
      setAssignedRoleCreate(null)
      setFiles([])
      markLocalHubMutation()
      await loadSilent()
      replaceListPanelUrl()
      setPanel('list')
    } catch (err: unknown) {
      const msg = formatSupabaseOrError(err)
      if (/row-level security/i.test(msg)) {
        markLocalHubMutation()
        await loadSilent()
        setError(null)
        setTitle('')
        setBody('')
        setImportance('normal')
        setAssignedRoleCreate(null)
        setFiles([])
        replaceListPanelUrl()
        setPanel('list')
      } else {
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  const onDeleteTask = async (t: NmHubTask) => {
    if (!isAdmin || readOnly) return
    setBusy(true)
    setError(null)
    try {
      await deleteHubTask(t.id)
      markLocalHubMutation()
      setPendingDeleteTask(null)
      await loadSilent()
    } catch (err: unknown) {
      setError(formatSupabaseOrError(err))
    } finally {
      setBusy(false)
    }
  }

  const onSetExecuted = async (t: NmHubTask, executed: boolean) => {
    if (readOnly) return
    setBusy(true)
    setError(null)
    markLocalHubMutation()
    try {
      await updateHubTaskExecuted(t.id, executed)
      await loadSilent()
      if (panel !== 'create') void refreshOlderPending()
    } catch (err: unknown) {
      setError(formatSupabaseOrError(err))
      await loadSilent()
    } finally {
      setBusy(false)
    }
  }

  const integratedSubtitle =
    panel === 'create'
      ? 'Nueva tarea'
      : listScope === 'completadas'
        ? 'Tareas completadas'
        : listScope === 'sent'
          ? 'Asignadas'
          : 'Mis tareas'

  const integratedSubtitleTone =
    panel === 'create'
      ? 'accent'
      : listScope === 'completadas'
        ? 'completed'
        : listScope === 'sent'
          ? 'completed'
          : 'pending'

  const showCreateBtn = !readOnly && (panel === 'create' || panel === 'list')

  return (
    <div className="nm-hub-app nm-hub-app--tasks">
      <header className="nm-hub-header dashboard-navbar">
        <HubBrandBar
          integratedDashboard
          adminSignOut={isAdmin}
          integratedSubtitle={integratedSubtitle}
          integratedSubtitleTone={integratedSubtitleTone}
          trailing={
            showCreateBtn ? (
              panel === 'list' ? (
                <button
                  type="button"
                  className="nm-hub-brand-bar__btn navbar-trailing-action-btn"
                  onClick={() => goCreatePanel()}
                  aria-label="Nueva tarea"
                  title="Nueva tarea"
                >
                  +
                </button>
              ) : (
                <button
                  type="button"
                  className="nm-hub-brand-bar__btn navbar-trailing-action-btn"
                  onClick={() => goListPanel()}
                  aria-label="Volver al listado"
                  title="Listado"
                >
                  ☰
                </button>
              )
            ) : null
          }
        />
      </header>

      {error ? (
        <p className="nm-hub-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="nm-hub-date-strip date-pager-fullwidth" aria-label="Día de las tareas">
        <div className="date-pager-side date-pager-side--start">
          <div className="date-pager-arrow-wrap">
            <button
              type="button"
              className="pager-arrow-btn"
              onClick={() => applyTaskDay(addDaysToIsoDate(taskDay, -1))}
              aria-label="Día anterior"
            >
              ←
            </button>
            {panel === 'list' && hasOlderPending ? (
              <span className="nm-hub-nav-pending-dot" title="Hay tareas pendientes en días anteriores" aria-hidden="true">
                !
              </span>
            ) : null}
          </div>
        </div>
        <div className="date-pager-center nm-hub-date-picker">
          <span className="date-text-accent nm-hub-date-display date-pager-display">{formatDayMonthShort(taskDay)}</span>
          <input
            type="date"
            className="nm-hub-input field-input nm-hub-date-native date-pager-native"
            value={taskDay}
            onChange={(e) => applyTaskDay(normalizeCalendarDate(e.target.value))}
            aria-label="Elegir día"
          />
        </div>
        <div className="date-pager-side date-pager-side--end">
          <button
            type="button"
            className="pager-arrow-btn"
            onClick={() => applyTaskDay(addDaysToIsoDate(taskDay, 1))}
            aria-label="Día siguiente"
          >
            →
          </button>
        </div>
      </section>

      {!readOnly && panel === 'create' ? (
        <form id="nm-hub-tareas-nueva" className="nm-hub-card nm-hub-card--task-create" onSubmit={(e) => void onCreate(e)}>
          <div className="form-container-clean">
          <div className="field-group">
            <label className="field-label" htmlFor="nm-hub-t-title">
              Título
            </label>
            <input
              id="nm-hub-t-title"
              className="nm-hub-input field-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="nm-hub-t-body">
              Detalle
            </label>
            <textarea
              id="nm-hub-t-body"
              className="nm-hub-textarea field-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
            />
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="nm-hub-t-imp">
              Importancia
            </label>
            <ImportanceSelect
              id="nm-hub-t-imp"
              value={importance}
              onChange={(v) => setImportance(v)}
              disabled={busy}
            />
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="nm-hub-t-assign">
              Asignar a:
            </label>
            <AssigneeRoleSelect
              id="nm-hub-t-assign"
              roles={assigneeRolesCreate}
              value={assignedRoleCreate}
              onChange={(v) => setAssignedRoleCreate(v)}
              disabled={busy}
            />
          </div>

          <div className="nm-hub-image-block">
            <span className="field-label" id="nm-hub-t-files-legend">
              Imágenes <span className="nm-hub-label-optional">(opcional)</span>
            </span>
            <input
              ref={taskGalleryInputRef}
              id="nm-hub-t-files-gallery"
              className="nm-hub-sr-only"
              type="file"
              accept="image/*"
              multiple
              aria-labelledby="nm-hub-t-files-legend"
              onChange={appendTaskFilesFromInput}
            />
            <input
              ref={taskCameraInputRef}
              id="nm-hub-t-files-camera"
              className="nm-hub-sr-only"
              type="file"
              accept="image/*"
              capture="environment"
              aria-labelledby="nm-hub-t-files-legend"
              onChange={appendTaskFilesFromInput}
            />
            <div className="nm-hub-image-picker upload-zone-rebel" role="group" aria-labelledby="nm-hub-t-files-legend nm-hub-t-files-title">
              <p className="nm-hub-image-picker-title upload-zone-title" id="nm-hub-t-files-title">
                Cargar imagen
              </p>
              <div className="nm-hub-image-picker-split upload-buttons-row">
                <button
                  type="button"
                  className="nm-hub-image-picker-split__btn upload-action-btn"
                  aria-label="Elegir desde la galería"
                  onClick={() => taskGalleryInputRef.current?.click()}
                >
                  <svg className="nm-hub-image-picker-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true">
                    <rect x="3" y="5" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                    <path
                      d="M7 19h12a2 2 0 002-2V9"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <circle cx="8.5" cy="10" r="1.25" fill="currentColor" />
                    <path d="M4 15l3.5-3.5a1 1 0 011.4 0L12 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="nm-hub-image-picker-split__btn upload-action-btn"
                  aria-label="Sacar foto con la cámara"
                  onClick={() => taskCameraInputRef.current?.click()}
                >
                  <svg className="nm-hub-image-picker-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true">
                    <path
                      d="M4 9h2.5l1.8-2.2h7.4L16.5 9H20a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2v-8a2 2 0 012-2z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                    <circle cx="12" cy="14" r="2.75" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </button>
              </div>
            </div>
            {files.length > 0 ? (
              <ul className="nm-hub-create-file-list" aria-label="Imágenes seleccionadas">
                {files.map((file, idx) => (
                  <li key={`${file.name}-${file.size}-${file.lastModified}-${idx}`} className="nm-hub-create-file-row">
                    <span className="nm-hub-create-file-name" title={file.name}>
                      {file.name}
                    </span>
                    <button
                      type="button"
                      className="nm-hub-btn nm-hub-btn-ghost nm-hub-create-file-remove"
                      onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                      aria-label={`Quitar ${file.name}`}
                    >
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <button type="submit" className="btn-submit-task" disabled={busy || assignedRoleCreate === null}>
            {busy ? 'Guardando…' : 'Crear tarea'}
          </button>
          </div>
        </form>
      ) : null}

      {panel === 'list' ? (
        <section id="nm-hub-tareas-lista" className="nm-hub-section nm-hub-section--task-list" aria-label="Tareas del día">
          <div className="tasks-hub-filters-stack">
            <div role="tablist" className="filter-track-rebel" aria-label="Vista de tareas">
              <button
                type="button"
                role="tab"
                aria-selected={listScope === 'inbox'}
                className={`filter-tab-item${listScope === 'inbox' ? ' active-pending' : ''}`}
                onClick={() => setListScopeInUrl('inbox')}
              >
                Mis tareas
              </button>
              {showSentTab ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={listScope === 'sent'}
                  className={`filter-tab-item${listScope === 'sent' ? ' active-pending' : ''}`}
                  onClick={() => setListScopeInUrl('sent')}
                >
                  Asignadas
                </button>
              ) : null}
              <button
                type="button"
                role="tab"
                aria-selected={listScope === 'completadas'}
                className={`filter-tab-item${listScope === 'completadas' ? ' active-completed' : ''}`}
                onClick={() => setListScopeInUrl('completadas')}
              >
                Completadas
              </button>
            </div>
            <div className="nm-hub-task-search-wrap tasks-hub-search-wrap">
              <label className="nm-hub-sr-only" htmlFor="nm-hub-task-q">
                Buscar en tareas
              </label>
              <input
                id="nm-hub-task-q"
                type="search"
                className="nm-hub-input field-input nm-hub-task-search"
                placeholder="Buscar"
                value={taskQuery}
                onChange={(e) => setTaskQuery(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>
          {loading && rawPending.length === 0 && rawCompleted.length === 0 ? (
            <p className="nm-hub-muted">Cargando…</p>
          ) : null}
          {!loading && sorted.length === 0 ? (
            <p className="nm-hub-muted">
              {listScope === 'completadas'
                ? 'No hay tareas completadas este día.'
                : listScope === 'sent'
                  ? 'No hay tareas asignadas a otros este día.'
                  : 'No hay tareas pendientes para vos este día.'}
            </p>
          ) : null}
          {!loading && sorted.length > 0 && filteredSorted.length === 0 ? (
            <p className="nm-hub-muted">Ninguna tarea coincide con la búsqueda.</p>
          ) : null}
          <ul className="nm-hub-task-list tasks-list-rebel" aria-busy={loading}>
            {filteredSorted.map((t) => {
              const assignedDone = listScope === 'sent' && Boolean(t.executed_at)
              return (
              <li
                key={t.id}
                className={`task-card-rebel nm-hub-task-item${assignedDone ? ' task-card-rebel--assigned-done' : ''}`}
                style={
                  {
                    '--accent-color': assignedDone ? '#535a62' : PRIORITY_ACCENT[t.importance],
                  } as CSSProperties
                }
              >
                <header className="task-card-header">
                  <div className="task-title-block">
                    <h3 className="task-card-title">{t.title}</h3>
                    <div className="task-badge-row">
                      <span
                        className={`badge-priority-rebel badge-priority-rebel--${t.importance}`}
                      >
                        {IMPORTANCE_LABEL[t.importance]}
                      </span>
                      <span className="task-assignee-chip" title="Destinatario asignado">
                        {HUB_TASK_ASSIGNEE_LABEL[t.assigned_role]}
                      </span>
                    </div>
                  </div>
                  <div className="task-card-header-actions">
                    {!readOnly && canMarkComplete(t) ? (
                      <button
                        type="button"
                        className="btn-complete-compact"
                        disabled={busy}
                        onClick={() => void onSetExecuted(t, true)}
                      >
                        Completar
                      </button>
                    ) : null}
                    {!readOnly && canUndoComplete(t) ? (
                      <button
                        type="button"
                        className="btn-undo-icon"
                        disabled={busy}
                        onClick={() => void onSetExecuted(t, false)}
                        aria-label="Devolver a pendiente"
                        title="Devolver a pendiente"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path
                            d="M9 14 4 9l5-5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M4 9h11a5 5 0 0 1 5 5v1"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    ) : null}
                    {isAdmin && !readOnly ? (
                      <button
                        type="button"
                        className="btn-delete-task"
                        disabled={busy}
                        onClick={() => setPendingDeleteTask(t)}
                        aria-label="Eliminar tarea"
                        title="Eliminar tarea"
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                </header>
                {assignedDone || (listScope === 'completadas' && t.executed_at) || t.body ? (
                  <div className="task-card-body">
                    {assignedDone || (listScope === 'completadas' && t.executed_at) ? (
                      <p className="task-meta-log">
                        Completada por{' '}
                        <strong>{t.executed_by ? executorNames[t.executed_by] ?? '…' : '—'}</strong>
                        {' · '}
                        {t.executed_at ? formatExecutedLabel(t.executed_at) : '—'}
                      </p>
                    ) : null}
                    {t.body ? <p className="task-description-text">{t.body}</p> : null}
                  </div>
                ) : null}
                <TaskThumbnails paths={t.image_paths ?? []} rebel />
              </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {!readOnly ? <HubPushNotificationSetup userId={profileId} variant="footer" /> : null}

      {pendingDeleteTask ? (
        <div className="nm-prod-modal-backdrop" role="presentation">
          <section className="nm-prod-modal" role="dialog" aria-modal="true">
            <h3 className="nm-prod-modal-title">Eliminar tarea</h3>
            <p className="nm-prod-modal-text">
              ¿Eliminar «{pendingDeleteTask.title}»? No se puede deshacer.
            </p>
            <div className="nm-prod-row">
              <button
                type="button"
                className="nm-prod-btn"
                disabled={busy}
                onClick={() => setPendingDeleteTask(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="nm-prod-btn nm-prod-btn-primary"
                disabled={busy}
                onClick={() => void onDeleteTask(pendingDeleteTask)}
              >
                {busy ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
