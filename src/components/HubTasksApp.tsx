import { Fragment, type FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  appendTaskImages,
  createHubTask,
  resolveAssignedToUserId,
  deleteHubTask,
  notifyTaskAssignedPush,
  fetchHubTaskNoteCounts,
  fetchAllHubTasks,
  signedImageUrl,
  updateHubTaskWorkflowStatus,
  updateHubTaskPaymentStatus,
} from '../lib/hubTasksApi'
import { formatSupabaseOrError } from '../lib/errors'
import { todayIsoLocal } from '../lib/date'
import { supabase } from '../lib/supabase'
import type {
  HubImportance,
  HubTaskPaymentStatus,
  HubTaskWorkflowStatus,
  HubUserRole,
  NmHubTask,
} from '../lib/types'
import { HubBrandBar } from './HubBrandBar'
import { HubDesktopNav } from './HubDesktopNav'
import { HubImageLightbox } from './HubImageLightbox'
import { HubTaskNotesPanel } from './HubTaskNotesPanel'
import { HubPushNotificationSetup } from './HubPushNotificationSetup'
import { HUB_NAV_EVENT } from '../lib/hubNavigate'
import {
  getTaskAssigneeRolesForCreator,
  HUB_TASK_ASSIGNEE_CREATE_LABEL,
  type HubTaskAssignableRole,
} from '../lib/hubTaskAssignable'
import { canDeleteHubTasks } from '../lib/hubRoles'
import {
  appendClientToTaskBody,
  normalizeMayoristaPhone,
  searchMayoristaClientsByName,
  upsertMayoristaClient,
} from '../lib/hubMayoristaClientsApi'
import { HubMayoristaClientModal } from './HubMayoristaClientModal'
import { parseShopifyOrderNumberFromTitle } from '../lib/shopifyOrderUrl'
import { resolveShopifyOrderUrls } from '../lib/logisticaAndreaniApi'
import type { HubTaskCreateType, NmHubMayoristaClient } from '../lib/types'

const TASK_TYPE_LABEL: Record<HubTaskCreateType, string> = {
  falta: 'Falta',
  mayorista: 'Mayorista',
  rehacer: 'Rehacer',
  canje: 'Canje',
  devolucion: 'Devolución',
}

const WORKFLOW_STATUS_OPTIONS: {
  value: HubTaskWorkflowStatus
  label: string
}[] = [
  { value: 'sin_ingresar', label: 'Sin ingresar' },
  { value: 'fabricacion', label: 'Fabricación' },
  { value: 'listo', label: 'Listo' },
  { value: 'enviado', label: 'Enviado' },
]

const PAYMENT_STATUS_OPTIONS: {
  value: HubTaskPaymentStatus
  label: string
}[] = [
  { value: 'sin_pagar', label: 'Sin pagar' },
  { value: 'pago', label: 'Pago' },
]

const TASK_CREATE_TYPES: HubTaskCreateType[] = [
  'mayorista',
  'rehacer',
  'canje',
  'devolucion',
]

function taskTypeUsesClientFields(type: HubTaskCreateType | null): boolean {
  return type === 'mayorista' || type === 'canje'
}

function taskTypeUsesOrderNumber(type: HubTaskCreateType | null): boolean {
  return type === 'rehacer' || type === 'devolucion'
}

function createFormTitleLabel(type: HubTaskCreateType | null): string {
  if (taskTypeUsesClientFields(type)) return 'Nombre del cliente'
  if (taskTypeUsesOrderNumber(type)) return 'Nº de orden'
  return 'Título'
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
          {value ? HUB_TASK_ASSIGNEE_CREATE_LABEL[value] : 'Elegí a quién va'}
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
              {HUB_TASK_ASSIGNEE_CREATE_LABEL[k]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

type TasksPanel = 'list' | 'create'

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

/** Completada: enviado + pago. */
function isHubTaskCompleted(t: NmHubTask): boolean {
  return (t.workflow_status ?? 'sin_ingresar') === 'enviado' && (t.payment_status ?? 'sin_pagar') === 'pago'
}

/** Pendientes arriba (más nuevas primero); completadas abajo (más nuevas primero). */
function sortTasksForList(list: NmHubTask[]): NmHubTask[] {
  return [...list].sort((a, b) => {
    const aDone = isHubTaskCompleted(a) ? 1 : 0
    const bDone = isHubTaskCompleted(b) ? 1 : 0
    if (aDone !== bDone) return aDone - bDone
    return Date.parse(b.created_at) - Date.parse(a.created_at)
  })
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
  profileDisplayName: string
  isAdmin: boolean
}

export function HubTasksApp({
  readOnly = false,
  profileRole,
  profileId,
  profileDisplayName: _profileDisplayName,
  isAdmin,
}: HubTasksAppProps) {
  const canDeleteTasks = canDeleteHubTasks(profileRole)
  const [rawTasks, setRawTasks] = useState<NmHubTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [expandedDetailIds, setExpandedDetailIds] = useState<Set<string>>(() => new Set())
  const [taskQuery, setTaskQuery] = useState('')
  const [pendingDeleteTask, setPendingDeleteTask] = useState<NmHubTask | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleteSelectedIds, setBulkDeleteSelectedIds] = useState<Set<string>>(() => new Set())
  const [notesTask, setNotesTask] = useState<NmHubTask | null>(null)
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({})
  /** nº orden → URL directa Shopify (misma que logística Andreani). */
  const [shopifyUrlsByOrder, setShopifyUrlsByOrder] = useState<Record<string, string>>({})

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

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [taskCreateType, setTaskCreateType] = useState<HubTaskCreateType | null>(null)
  const [clientDni, setClientDni] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [clientAddress, setClientAddress] = useState('')
  const [clientSuggestions, setClientSuggestions] = useState<NmHubMayoristaClient[]>([])
  const [clientSuggestOpen, setClientSuggestOpen] = useState(false)
  const [clientModalOpen, setClientModalOpen] = useState(false)
  const [assignedRoleCreate, setAssignedRoleCreate] = useState<HubTaskAssignableRole | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const taskGalleryInputRef = useRef<HTMLInputElement>(null)
  const taskCameraInputRef = useRef<HTMLInputElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const clientSuggestRef = useRef<HTMLDivElement>(null)
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

  const loadSilent = useCallback(async () => {
    const seq = ++tasksLoadSeqRef.current
    const rows = await fetchAllHubTasks()
    if (seq !== tasksLoadSeqRef.current) return
    setRawTasks(rows)
    void fetchHubTaskNoteCounts(rows.map((t) => t.id))
      .then((c) => {
        if (seq !== tasksLoadSeqRef.current) return
        setNoteCounts(c)
      })
      .catch(() => {
        if (seq !== tasksLoadSeqRef.current) return
        setNoteCounts({})
      })
  }, [hubDataGen, profileRole, profileId])

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

    const scheduleSyncFromServer = () => {
      if (Date.now() < suppressHubRealtimeUntilRef.current) return
      if (hubTasksRealtimeDebounceRef.current !== null) {
        window.clearTimeout(hubTasksRealtimeDebounceRef.current)
      }
      hubTasksRealtimeDebounceRef.current = window.setTimeout(() => {
        hubTasksRealtimeDebounceRef.current = null
        void loadSilent().catch(() => {})
      }, 150)
    }

    const channel = sb
      .channel('nm_hub_tasks:all')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'nm_hub_tasks' },
        () => {
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
  }, [loadSilent])

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

  const sorted = useMemo(() => sortTasksForList(rawTasks), [rawTasks])

  const orderNumbersKey = useMemo(() => {
    const nums = new Set<string>()
    for (const t of rawTasks) {
      const n = parseShopifyOrderNumberFromTitle(t.title ?? '')
      if (n) nums.add(n)
    }
    return [...nums].sort().join(',')
  }, [rawTasks])

  useEffect(() => {
    if (!orderNumbersKey) {
      setShopifyUrlsByOrder({})
      return
    }
    let cancelled = false
    void resolveShopifyOrderUrls(orderNumbersKey.split(','))
      .then((orders) => {
        if (cancelled) return
        const next: Record<string, string> = {}
        for (const [key, row] of Object.entries(orders)) {
          if (row?.shopify_url) next[key] = row.shopify_url
        }
        setShopifyUrlsByOrder(next)
      })
      .catch(() => {
        if (!cancelled) setShopifyUrlsByOrder({})
      })
    return () => {
      cancelled = true
    }
  }, [orderNumbersKey])

  const filteredSorted = useMemo(() => {
    const q = taskQuery.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((t) => {
      const title = (t.title ?? '').toLowerCase()
      const body = (t.body ?? '').toLowerCase()
      return title.includes(q) || body.includes(q)
    })
  }, [sorted, taskQuery])

  const goCreatePanel = useCallback(() => {
    if (readOnly) return
    replaceCreatePanelUrl()
    setPanel('create')
  }, [readOnly])

  const resetCreateForm = useCallback(() => {
    setTitle('')
    setBody('')
    setTaskCreateType(null)
    setClientDni('')
    setClientPhone('')
    setClientEmail('')
    setClientAddress('')
    setClientSuggestions([])
    setClientSuggestOpen(false)
    setAssignedRoleCreate(null)
    setFiles([])
  }, [])

  const applyClientSelection = useCallback((client: NmHubMayoristaClient) => {
    setTitle(client.full_name)
    setClientDni(client.dni)
    setClientPhone(client.phone)
    setClientEmail(client.email)
    setClientAddress(client.address)
    setClientSuggestOpen(false)
  }, [])

  const toggleDetail = useCallback((taskId: string) => {
    setExpandedDetailIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }, [])

  const patchTaskLocal = useCallback((updated: NmHubTask) => {
    setRawTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
  }, [])

  const onWorkflowChange = async (t: NmHubTask, status: HubTaskWorkflowStatus) => {
    if (readOnly) return
    setBusy(true)
    setError(null)
    markLocalHubMutation()
    try {
      const updated = await updateHubTaskWorkflowStatus(t.id, status)
      patchTaskLocal(updated)
    } catch (err: unknown) {
      setError(formatSupabaseOrError(err))
      await loadSilent()
    } finally {
      setBusy(false)
    }
  }

  const onPaymentChange = async (t: NmHubTask, status: HubTaskPaymentStatus) => {
    if (readOnly) return
    setBusy(true)
    setError(null)
    markLocalHubMutation()
    try {
      const updated = await updateHubTaskPaymentStatus(t.id, status)
      patchTaskLocal(updated)
    } catch (err: unknown) {
      setError(formatSupabaseOrError(err))
      await loadSilent()
    } finally {
      setBusy(false)
    }
  }

  const applyTaskType = useCallback((type: HubTaskCreateType) => {
    setTaskCreateType(type)
    setClientDni('')
    setClientPhone('')
    setClientEmail('')
    setClientAddress('')
    setClientSuggestions([])
    setClientSuggestOpen(false)
    setError(null)
    setTitle('')
  }, [])

  useEffect(() => {
    if (!taskTypeUsesClientFields(taskCreateType)) {
      setClientSuggestions([])
      setClientSuggestOpen(false)
      return
    }
    const q = title.trim()
    if (q.length < 1) {
      setClientSuggestions([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void searchMayoristaClientsByName(q)
        .then((rows) => {
          if (!cancelled) {
            setClientSuggestions(rows)
            setClientSuggestOpen(rows.length > 0)
          }
        })
        .catch(() => {
          if (!cancelled) setClientSuggestions([])
        })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [title, taskCreateType])

  useEffect(() => {
    if (!clientSuggestOpen) return
    const onDocDown = (e: MouseEvent) => {
      const root = clientSuggestRef.current
      const input = titleInputRef.current
      if (root?.contains(e.target as Node) || input?.contains(e.target as Node)) return
      setClientSuggestOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [clientSuggestOpen])

  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (readOnly || !title.trim() || assignedRoleCreate === null || !taskCreateType) return
    setBusy(true)
    setError(null)
    const titleDraft = title.trim()

    if (taskTypeUsesOrderNumber(taskCreateType) && !body.trim()) {
      setError(
        taskCreateType === 'devolucion'
          ? 'Indicá el motivo de la devolución.'
          : 'Indicá el motivo del rehacer.',
      )
      setBusy(false)
      return
    }

    let finalBody = body.trim() || null
    const finalImportance: HubImportance = 'normal'

    try {
      if (taskTypeUsesClientFields(taskCreateType)) {
        const clientPayload = {
          full_name: titleDraft,
          dni: clientDni.trim(),
          phone: normalizeMayoristaPhone(clientPhone),
          email: clientEmail.trim(),
          address: clientAddress.trim(),
        }
        if (
          !clientPayload.dni ||
          !clientPayload.phone ||
          !clientPayload.email ||
          !clientPayload.address
        ) {
          setError('Completá todos los datos del cliente.')
          setBusy(false)
          return
        }
        await upsertMayoristaClient(clientPayload)
        finalBody = appendClientToTaskBody(body, clientPayload)
      }

      const assignedTo = await resolveAssignedToUserId(assignedRoleCreate)
      const created = await createHubTask({
        title: titleDraft,
        body: finalBody,
        importance: finalImportance,
        for_date: todayIsoLocal(),
        assigned_role: assignedRoleCreate,
        assigned_to: assignedTo,
        task_type: taskCreateType,
      })
      if (files.length > 0) {
        await appendTaskImages(created.id, files, created.image_paths ?? [])
      }
      const pushResult = await notifyTaskAssignedPush(created)
      if (!pushResult.ok && pushResult.reason === 'no-subscriptions') {
        console.warn('[nm-hub] Sin suscripción push del destinatario:', pushResult)
      }
      resetCreateForm()
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
        resetCreateForm()
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
    if (!canDeleteTasks || readOnly) return
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

  const openBulkDeleteCompleted = useCallback(
    (preselectId?: string) => {
      if (!canDeleteTasks || readOnly) return
      const initial = new Set<string>()
      if (preselectId) initial.add(preselectId)
      setBulkDeleteSelectedIds(initial)
      setBulkDeleteOpen(true)
      setError(null)
    },
    [canDeleteTasks, readOnly],
  )

  const toggleBulkDeleteId = useCallback((taskId: string) => {
    setBulkDeleteSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }, [])

  const selectAllBulkDelete = useCallback(() => {
    setBulkDeleteSelectedIds(new Set(filteredSorted.map((t) => t.id)))
  }, [filteredSorted])

  const clearBulkDeleteSelection = useCallback(() => {
    setBulkDeleteSelectedIds(new Set())
  }, [])

  const onBulkDeleteCompleted = async () => {
    if (!canDeleteTasks || readOnly || bulkDeleteSelectedIds.size === 0) return
    setBusy(true)
    setError(null)
    try {
      const ids = [...bulkDeleteSelectedIds]
      for (const id of ids) {
        await deleteHubTask(id)
      }
      markLocalHubMutation()
      setBulkDeleteOpen(false)
      setBulkDeleteSelectedIds(new Set())
      await loadSilent()
    } catch (err: unknown) {
      setError(formatSupabaseOrError(err))
    } finally {
      setBusy(false)
    }
  }

  const integratedSubtitle = panel === 'create' ? 'Nueva tarea' : 'Completadas'

  const integratedSubtitleTone = panel === 'create' ? 'accent' : 'completed'

  const showCreateNavBtn = !readOnly && panel === 'list'

  return (
    <div className="nm-hub-app nm-hub-app--tasks">
      <header className="nm-hub-header dashboard-navbar">
        <HubBrandBar
          integratedDashboard
          adminSignOut={isAdmin}
          integratedSubtitle={integratedSubtitle}
          integratedSubtitleTone={integratedSubtitleTone}
          trailing={
            showCreateNavBtn ? (
              <button
                type="button"
                className="nm-hub-brand-bar__btn navbar-trailing-action-btn"
                onClick={() => goCreatePanel()}
                aria-label="Nueva tarea"
                title="Nueva tarea"
              >
                +
              </button>
            ) : null
          }
        />
      </header>

      <HubDesktopNav role={profileRole} />

      {error ? (
        <p className="nm-hub-error" role="alert">
          {error}
        </p>
      ) : null}

      {!readOnly && panel === 'create' ? (
        <form id="nm-hub-tareas-nueva" className="nm-hub-card nm-hub-card--task-create" onSubmit={(e) => void onCreate(e)}>
          <div className="form-container-clean">
          <div className="field-group">
            <span className="field-label" id="nm-hub-t-type-label">
              Tipo de tarea
            </span>
            <div className="task-create-preset-row" role="group" aria-labelledby="nm-hub-t-type-label">
              {TASK_CREATE_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`task-create-preset-btn task-create-preset-btn--${type}${taskCreateType === type ? ' task-create-preset-btn--active' : ''}`}
                  onClick={() => applyTaskType(type)}
                  disabled={busy}
                  aria-pressed={taskCreateType === type}
                >
                  {TASK_TYPE_LABEL[type]}
                </button>
              ))}
              <button
                type="button"
                className="task-create-preset-btn task-create-preset-btn--crear-cliente"
                onClick={() => setClientModalOpen(true)}
                disabled={busy}
              >
                Cliente
              </button>
            </div>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="nm-hub-t-title">
              {createFormTitleLabel(taskCreateType)}
            </label>
            <div className="task-create-title-wrap">
              <input
                ref={titleInputRef}
                id="nm-hub-t-title"
                className="nm-hub-input field-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onFocus={() => {
                  if (taskTypeUsesClientFields(taskCreateType) && clientSuggestions.length > 0) {
                    setClientSuggestOpen(true)
                  }
                }}
                required
                disabled={!taskCreateType || busy}
                autoComplete="off"
              />
              {taskTypeUsesClientFields(taskCreateType) && clientSuggestOpen && clientSuggestions.length > 0 ? (
                <div ref={clientSuggestRef} className="task-create-client-suggest" role="listbox">
                  {clientSuggestions.map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      role="option"
                      className="task-create-client-suggest__item"
                      onClick={() => applyClientSelection(client)}
                    >
                      {client.full_name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {taskTypeUsesClientFields(taskCreateType) ? (
            <div className="task-create-client-fields">
              <div className="field-group">
                <label className="field-label" htmlFor="nm-hub-t-client-dni">
                  DNI
                </label>
                <input
                  id="nm-hub-t-client-dni"
                  className="nm-hub-input field-input"
                  value={clientDni}
                  onChange={(e) => setClientDni(e.target.value)}
                  disabled={busy}
                  required
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="nm-hub-t-client-phone">
                  Teléfono
                </label>
                <input
                  id="nm-hub-t-client-phone"
                  className="nm-hub-input field-input"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  onBlur={() => setClientPhone(normalizeMayoristaPhone(clientPhone))}
                  inputMode="tel"
                  disabled={busy}
                  required
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="nm-hub-t-client-email">
                  Email
                </label>
                <input
                  id="nm-hub-t-client-email"
                  className="nm-hub-input field-input"
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  disabled={busy}
                  required
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="nm-hub-t-client-address">
                  Dirección de domicilio
                </label>
                <input
                  id="nm-hub-t-client-address"
                  className="nm-hub-input field-input"
                  value={clientAddress}
                  onChange={(e) => setClientAddress(e.target.value)}
                  disabled={busy}
                  required
                />
              </div>
            </div>
          ) : null}

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
              required={taskTypeUsesOrderNumber(taskCreateType)}
              disabled={!taskCreateType || busy}
              placeholder={
                taskCreateType === 'rehacer'
                  ? 'Indicá por qué hay que rehacer esta tarea'
                  : taskCreateType === 'devolucion'
                    ? 'Indicá el motivo de la devolución'
                    : undefined
              }
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
              disabled={busy || !taskCreateType}
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

          <button
            type="submit"
            className="btn-submit-task"
            disabled={busy || assignedRoleCreate === null || !taskCreateType}
          >
            {busy ? 'Guardando…' : 'Crear tarea'}
          </button>
          </div>
        </form>
      ) : null}

      <HubMayoristaClientModal
        open={clientModalOpen}
        busy={busy}
        error={null}
        onClose={() => setClientModalOpen(false)}
        onSaved={() => {
          setError(null)
        }}
      />

      {panel === 'list' ? (
        <section id="nm-hub-tareas-lista" className="nm-hub-section nm-hub-section--task-list" aria-label="Tareas completadas">
          <div className="tasks-hub-filters-stack">
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
          {loading && rawTasks.length === 0 ? (
            <p className="nm-hub-muted">Cargando…</p>
          ) : null}
          {!loading && sorted.length === 0 ? (
            <p className="nm-hub-muted">No hay tareas.</p>
          ) : null}
          {!loading && sorted.length > 0 && filteredSorted.length === 0 ? (
            <p className="nm-hub-muted">Ninguna tarea coincide con la búsqueda.</p>
          ) : null}
          <div className="hub-tasks-table-wrap" aria-busy={loading}>
            <table className="hub-tasks-table">
              <thead>
                <tr>
                  <th scope="col">Tipo</th>
                  <th scope="col">Título</th>
                  <th scope="col">Detalle</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Pago</th>
                  <th scope="col">Ver en Shopify</th>
                  <th scope="col" className="hub-tasks-table__col-delete">
                    <span className="nm-hub-sr-only">Eliminar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredSorted.map((t) => {
                  const expanded = expandedDetailIds.has(t.id)
                  const workflow = t.workflow_status ?? 'sin_ingresar'
                  const payment = t.payment_status ?? 'sin_pagar'
                  const completed = isHubTaskCompleted(t)
                  const orderNumber = parseShopifyOrderNumberFromTitle(t.title)
                  const shopifyUrl = orderNumber ? (shopifyUrlsByOrder[orderNumber] ?? null) : null
                  const rowClass = `hub-tasks-table__row${completed ? ' hub-tasks-table__row--completed' : ' hub-tasks-table__row--pending'}`
                  return (
                    <Fragment key={t.id}>
                      <tr className={rowClass}>
                        <td>
                          {t.task_type ? (
                            <span className={`task-type-badge task-type-badge--${t.task_type}`}>
                              {TASK_TYPE_LABEL[t.task_type]}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="hub-tasks-table__title">{t.title}</td>
                        <td className="hub-tasks-table__detail-toggle">
                          {t.body ? (
                            <button
                              type="button"
                              className="hub-tasks-table__detail-btn"
                              onClick={() => toggleDetail(t.id)}
                              aria-expanded={expanded}
                            >
                              {expanded ? 'Ocultar' : 'Ver detalle'}
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <select
                            className={`hub-tasks-status-select hub-tasks-status-select--${workflow}`}
                            value={workflow}
                            disabled={busy || readOnly}
                            aria-label={`Estado de ${t.title}`}
                            onChange={(e) =>
                              void onWorkflowChange(t, e.target.value as HubTaskWorkflowStatus)
                            }
                          >
                            {WORKFLOW_STATUS_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            className={`hub-tasks-status-select hub-tasks-payment-select--${payment}`}
                            value={payment}
                            disabled={busy || readOnly}
                            aria-label={`Pago de ${t.title}`}
                            onChange={(e) =>
                              void onPaymentChange(t, e.target.value as HubTaskPaymentStatus)
                            }
                          >
                            {PAYMENT_STATUS_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="hub-tasks-table__shopify">
                          {shopifyUrl ? (
                            <a
                              className="hub-tasks-shopify-btn"
                              href={shopifyUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Ver orden Shopify de ${t.title}`}
                            >
                              Ver en Shopify
                            </a>
                          ) : (
                            <span
                              className="hub-tasks-shopify-btn hub-tasks-shopify-btn--disabled"
                              aria-disabled="true"
                              title={
                                orderNumber
                                  ? 'No se encontró la orden en Shopify'
                                  : 'Sin nº de orden en el título'
                              }
                            >
                              Ver en Shopify
                            </span>
                          )}
                        </td>
                        <td className="hub-tasks-table__col-delete">
                          <div className="hub-tasks-table__row-actions">
                            <button
                              type="button"
                              className="btn-task-notes hub-tasks-table__action-btn"
                              onClick={() => setNotesTask(t)}
                            >
                              Notas
                              {noteCounts[t.id] ? (
                                <span className="btn-task-notes__count" aria-hidden="true">
                                  {noteCounts[t.id]}
                                </span>
                              ) : null}
                            </button>
                            {canDeleteTasks && !readOnly ? (
                              <button
                                type="button"
                                className="btn-delete-task btn-delete-task--trash hub-tasks-table__action-btn"
                                disabled={busy}
                                onClick={() => openBulkDeleteCompleted(t.id)}
                                aria-label="Seleccionar tareas a eliminar"
                                title="Eliminar tareas"
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                  <path d="M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                  <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                  <path
                                    d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <path
                                    d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                      {expanded && t.body ? (
                        <tr
                          className={`hub-tasks-table__detail-row${completed ? ' hub-tasks-table__detail-row--completed' : ''}`}
                        >
                          <td colSpan={7}>
                            <div className="hub-tasks-table__detail-body">{t.body}</div>
                            {(t.image_paths?.length ?? 0) > 0 ? (
                              <TaskThumbnails paths={t.image_paths ?? []} rebel />
                            ) : null}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!readOnly ? <HubPushNotificationSetup userId={profileId} variant="footer" /> : null}

      {notesTask ? (
        <HubTaskNotesPanel
          task={notesTask}
          profileId={profileId}
          onClose={() => setNotesTask(null)}
          onNoteAdded={() => {
            const id = notesTask.id
            setNoteCounts((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
          }}
          onNoteRemoved={() => {
            const id = notesTask.id
            setNoteCounts((prev) => {
              const next = Math.max(0, (prev[id] ?? 1) - 1)
              if (next === 0) {
                const { [id]: _removed, ...rest } = prev
                return rest
              }
              return { ...prev, [id]: next }
            })
          }}
        />
      ) : null}

      {bulkDeleteOpen ? (
        <div
          className="nm-prod-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setBulkDeleteOpen(false)
              setBulkDeleteSelectedIds(new Set())
            }
          }}
        >
          <section
            className="nm-prod-modal hub-tasks-bulk-delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hub-bulk-delete-title"
          >
            <h3 className="nm-prod-modal-title" id="hub-bulk-delete-title">
              Eliminar tareas
            </h3>
            <p className="nm-prod-modal-text">
              Seleccioná las tareas que querés eliminar. Esta acción no se puede deshacer.
            </p>
            <div className="hub-tasks-bulk-delete-toolbar">
              <button
                type="button"
                className="nm-prod-btn"
                disabled={busy || filteredSorted.length === 0}
                onClick={selectAllBulkDelete}
              >
                Seleccionar todas
              </button>
              <button
                type="button"
                className="nm-prod-btn"
                disabled={busy || bulkDeleteSelectedIds.size === 0}
                onClick={clearBulkDeleteSelection}
              >
                Limpiar
              </button>
            </div>
            <ul className="hub-tasks-bulk-delete-list" role="listbox" aria-multiselectable="true">
              {filteredSorted.length === 0 ? (
                <li className="hub-tasks-bulk-delete-empty">No hay tareas.</li>
              ) : (
                filteredSorted.map((t) => {
                  const checked = bulkDeleteSelectedIds.has(t.id)
                  return (
                    <li key={t.id}>
                      <label className={`hub-tasks-bulk-delete-item${checked ? ' is-selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busy}
                          onChange={() => toggleBulkDeleteId(t.id)}
                        />
                        <span className="hub-tasks-bulk-delete-item__type">
                          {t.task_type ? TASK_TYPE_LABEL[t.task_type] : '—'}
                        </span>
                        <span className="hub-tasks-bulk-delete-item__title">{t.title}</span>
                      </label>
                    </li>
                  )
                })
              )}
            </ul>
            <div className="nm-prod-row">
              <button
                type="button"
                className="nm-prod-btn"
                disabled={busy}
                onClick={() => {
                  setBulkDeleteOpen(false)
                  setBulkDeleteSelectedIds(new Set())
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="nm-prod-btn nm-prod-btn-primary hub-tasks-bulk-delete-confirm"
                disabled={busy || bulkDeleteSelectedIds.size === 0}
                onClick={() => void onBulkDeleteCompleted()}
              >
                {busy
                  ? 'Eliminando…'
                  : bulkDeleteSelectedIds.size === 0
                    ? 'Eliminar'
                    : `Eliminar (${bulkDeleteSelectedIds.size})`}
              </button>
            </div>
          </section>
        </div>
      ) : null}

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
