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
  updateHubTask,
  updateHubTaskWorkflowStatus,
  updateHubTaskPaymentStatus,
  updateHubTaskTrackingUrl,
  replaceHubTaskImages,
  validateHubTaskImageFile,
} from '../lib/hubTasksApi'
import { formatSupabaseOrError } from '../lib/errors'
import {
  addMonthsToYearMonth,
  currentYearMonthLocal,
  formatMonthYearLabel,
  parseYearMonth,
  todayIsoLocal,
} from '../lib/date'
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
import { HubTasksPillSelect, type HubTasksPillOption } from './HubTasksPillSelect'
import { HubPushNotificationSetup } from './HubPushNotificationSetup'
import { HUB_NAV_EVENT } from '../lib/hubNavigate'
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

/** Rol interno por defecto (ya no se elige destinatario en la UI). */
const DEFAULT_ASSIGNED_ROLE = 'taller_1' as const

const TASK_TYPE_LABEL: Record<HubTaskCreateType, string> = {
  falta: 'Falta',
  mayorista: 'Mayorista',
  rehacer: 'Rehacer',
  canje: 'Canje',
  devolucion: 'Devolución',
}

const WORKFLOW_STATUS_OPTIONS: HubTasksPillOption<HubTaskWorkflowStatus>[] = [
  { value: 'sin_ingresar', label: 'Sin ingresar', toneClass: 'hub-tasks-status-select--sin_ingresar' },
  { value: 'fabricacion', label: 'Fabricación', toneClass: 'hub-tasks-status-select--fabricacion' },
  { value: 'listo', label: 'Listo', toneClass: 'hub-tasks-status-select--listo' },
  { value: 'enviado', label: 'Enviado', toneClass: 'hub-tasks-status-select--enviado' },
]

const PAYMENT_STATUS_OPTIONS: HubTasksPillOption<HubTaskPaymentStatus>[] = [
  { value: 'sin_pagar', label: 'Sin pagar', toneClass: 'hub-tasks-payment-select--sin_pagar' },
  { value: 'pago', label: 'Pago', toneClass: 'hub-tasks-payment-select--pago' },
]

const TASK_CREATE_TYPES: HubTaskCreateType[] = [
  'mayorista',
  'rehacer',
  'canje',
  'devolucion',
]

const TASK_FILTER_TYPES: HubTaskCreateType[] = [
  'mayorista',
  'rehacer',
  'canje',
  'devolucion',
  'falta',
]

type TaskCompletionFilter = 'all' | 'pending' | 'completed'

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

function yearMonthFromCreatedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatTaskCreatedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

function normalizeExternalUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  // Si pegaron texto con un link adentro, usar el primer URL detectado.
  const embedded = t.match(/https?:\/\/[^\s<>"']+/i)
  if (embedded) {
    return embedded[0].replace(/[),.;]+$/g, '')
  }
  // Dominio sin protocolo (ej. andreani.com/?numero=123)
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/:?].*)?$/i.test(t)) {
    return `https://${t}`
  }
  if (/^www\./i.test(t)) {
    return `https://${t}`
  }
  return null
}

/** URL lista para abrir en un click (siempre con protocolo). */
function trackingHref(raw: string | null | undefined): string | null {
  if (!raw) return null
  return normalizeExternalUrl(raw)
}

function tasksYearMonthFromLocation(): string {
  if (typeof window === 'undefined') return currentYearMonthLocal()
  const m = new URLSearchParams(window.location.search).get('m')
  return parseYearMonth(m ?? '') ? (m as string) : currentYearMonthLocal()
}

function replaceTasksMonthUrl(yearMonth: string) {
  if (typeof window === 'undefined') return
  const u = new URL(window.location.href)
  u.searchParams.set('m', yearMonth)
  window.history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`)
  window.dispatchEvent(new CustomEvent(HUB_NAV_EVENT))
}

type TasksPanel = 'list' | 'create'
type ClientDataChoice = null | 'yes' | 'no'

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

function TaskThumbnails({
  paths,
  rebel = false,
  compact = false,
}: {
  paths: string[]
  rebel?: boolean
  compact?: boolean
}) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const pathsKey = paths.join('|')

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
  }, [pathsKey])

  if (paths.length === 0) return null

  const orderedUrls = paths.map((p) => urls[p]).filter(Boolean) as string[]
  const firstPath = paths[0]
  const firstUrl = urls[firstPath]
  const extraCount = Math.max(0, paths.length - 1)

  const wrapCls = [
    rebel ? 'task-media-attachment' : 'nm-hub-task-images',
    compact ? 'task-media-attachment--compact' : '',
    compact ? 'task-media-attachment--single' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const btnCls = rebel ? 'task-thumb-hit' : 'nm-hub-thumb-btn'
  const imgCls = [
    rebel ? 'task-thumb-rebel' : 'nm-hub-thumb',
    compact ? 'task-thumb-rebel--compact' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const openGallery = (index = 0) => {
    if (orderedUrls.length === 0) return
    setLightboxIndex(Math.min(index, orderedUrls.length - 1))
  }

  // Compacto (tabla tareas): 1 foto + indicador de más en la misma fila.
  if (compact) {
    return (
      <>
        <div className={wrapCls}>
          {firstUrl ? (
            <button
              type="button"
              className={`${btnCls} task-thumb-hit--primary`}
              onClick={() => openGallery(0)}
              aria-label={extraCount > 0 ? `Ampliar imagen (1 de ${paths.length})` : 'Ampliar imagen'}
            >
              <img src={firstUrl} alt="" className={imgCls} />
            </button>
          ) : (
            <span className="nm-hub-thumb-placeholder nm-hub-thumb-placeholder--compact" aria-hidden />
          )}
          {extraCount > 0 ? (
            <button
              type="button"
              className="task-thumb-more"
              onClick={() => openGallery(0)}
              aria-label={`Ver ${extraCount} imagen${extraCount === 1 ? '' : 'es'} más`}
              title={`${paths.length} imágenes`}
            >
              {urls[paths[1]] ? (
                <img src={urls[paths[1]]} alt="" className="task-thumb-more__peek" />
              ) : (
                <span className="task-thumb-more__peek task-thumb-more__peek--empty" aria-hidden />
              )}
              <span className="task-thumb-more__badge">+{extraCount}</span>
            </button>
          ) : null}
        </div>
        {lightboxIndex !== null && orderedUrls[lightboxIndex] ? (
          <HubImageLightbox
            src={orderedUrls[lightboxIndex]}
            onClose={() => setLightboxIndex(null)}
            gallery={
              orderedUrls.length > 1
                ? {
                    index: lightboxIndex,
                    total: orderedUrls.length,
                    onPrev: () => setLightboxIndex((i) => (i === null ? 0 : Math.max(0, i - 1))),
                    onNext: () =>
                      setLightboxIndex((i) =>
                        i === null ? 0 : Math.min(orderedUrls.length - 1, i + 1),
                      ),
                  }
                : undefined
            }
          />
        ) : null}
      </>
    )
  }

  return (
    <>
      <div className={wrapCls}>
        {paths.map((p, idx) =>
          urls[p] ? (
            <button
              key={p}
              type="button"
              className={btnCls}
              onClick={() => openGallery(idx)}
              aria-label="Ampliar imagen"
            >
              <img src={urls[p]} alt="" className={imgCls} />
            </button>
          ) : (
            <span key={p} className="nm-hub-thumb-placeholder" aria-hidden />
          ),
        )}
      </div>
      {lightboxIndex !== null && orderedUrls[lightboxIndex] ? (
        <HubImageLightbox
          src={orderedUrls[lightboxIndex]}
          onClose={() => setLightboxIndex(null)}
          gallery={
            orderedUrls.length > 1
              ? {
                  index: lightboxIndex,
                  total: orderedUrls.length,
                  onPrev: () => setLightboxIndex((i) => (i === null ? 0 : Math.max(0, i - 1))),
                  onNext: () =>
                    setLightboxIndex((i) =>
                      i === null ? 0 : Math.min(orderedUrls.length - 1, i + 1),
                    ),
                }
              : undefined
          }
        />
      ) : null}
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
  const [typeFilter, setTypeFilter] = useState<HubTaskCreateType | 'all'>('all')
  const [completionFilter, setCompletionFilter] = useState<TaskCompletionFilter>('all')
  const [pendingDeleteTask, setPendingDeleteTask] = useState<NmHubTask | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleteSelectedIds, setBulkDeleteSelectedIds] = useState<Set<string>>(() => new Set())
  const [notesTask, setNotesTask] = useState<NmHubTask | null>(null)
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({})
  const [trackingEditTask, setTrackingEditTask] = useState<NmHubTask | null>(null)
  const [trackingDraft, setTrackingDraft] = useState('')
  const [editTask, setEditTask] = useState<NmHubTask | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editTracking, setEditTracking] = useState('')
  const [editKeptPaths, setEditKeptPaths] = useState<string[]>([])
  const [editNewFiles, setEditNewFiles] = useState<File[]>([])
  const [editImageUrls, setEditImageUrls] = useState<Record<string, string>>({})
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
  /** null = aún no eligió; yes = mostrar/guardar datos; no = solo título. */
  const [loadClientData, setLoadClientData] = useState<ClientDataChoice>(null)
  const [pendingClient, setPendingClient] = useState<NmHubMayoristaClient | null>(null)
  const [yearMonth, setYearMonth] = useState(() =>
    typeof window !== 'undefined' ? tasksYearMonthFromLocation() : currentYearMonthLocal(),
  )
  const [files, setFiles] = useState<File[]>([])
  const taskGalleryInputRef = useRef<HTMLInputElement>(null)
  const taskCameraInputRef = useRef<HTMLInputElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const clientSuggestRef = useRef<HTMLDivElement>(null)
  const [imageDragOver, setImageDragOver] = useState(false)
  const [filePreviewUrls, setFilePreviewUrls] = useState<string[]>([])
  /** Evita que un fetch viejo pise tareas nuevas (realtime + mutación simultánea). */
  const tasksLoadSeqRef = useRef(0)
  const hubTasksRealtimeDebounceRef = useRef<number | null>(null)
  /** Tras completar/crear en este cliente, ignorar realtime breve (ya hay patch local). */
  const suppressHubRealtimeUntilRef = useRef(0)

  const markLocalHubMutation = useCallback(() => {
    suppressHubRealtimeUntilRef.current = Date.now() + 900
  }, [])

  const appendImageFiles = useCallback((list: FileList | File[] | null | undefined) => {
    if (!list) return
    const images = Array.from(list).filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) return
    setFiles((prev) => [...prev, ...images])
  }, [])

  const appendTaskFilesFromInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      appendImageFiles(e.target.files)
      e.target.value = ''
    },
    [appendImageFiles],
  )

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f))
    setFilePreviewUrls(urls)
    return () => {
      for (const u of urls) URL.revokeObjectURL(u)
    }
  }, [files])

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

  const monthTasks = useMemo(() => {
    return rawTasks.filter((t) => yearMonthFromCreatedAt(t.created_at) === yearMonth)
  }, [rawTasks, yearMonth])

  const sorted = useMemo(() => sortTasksForList(monthTasks), [monthTasks])

  const orderNumbersKey = useMemo(() => {
    const nums = new Set<string>()
    for (const t of monthTasks) {
      const n = parseShopifyOrderNumberFromTitle(t.title ?? '')
      if (n) nums.add(n)
    }
    return [...nums].sort().join(',')
  }, [monthTasks])

  useEffect(() => {
    const syncMonth = () => {
      if (normalizeTasksPathname() !== '/tareas') return
      setYearMonth(tasksYearMonthFromLocation())
    }
    syncMonth()
    window.addEventListener(HUB_NAV_EVENT, syncMonth as EventListener)
    window.addEventListener('popstate', syncMonth)
    return () => {
      window.removeEventListener(HUB_NAV_EVENT, syncMonth as EventListener)
      window.removeEventListener('popstate', syncMonth)
    }
  }, [])

  const applyMonth = useCallback((next: string) => {
    setYearMonth(next)
    replaceTasksMonthUrl(next)
  }, [])

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
    return sorted.filter((t) => {
      if (typeFilter !== 'all' && t.task_type !== typeFilter) return false
      if (completionFilter === 'pending' && isHubTaskCompleted(t)) return false
      if (completionFilter === 'completed' && !isHubTaskCompleted(t)) return false
      if (!q) return true
      const title = (t.title ?? '').toLowerCase()
      const body = (t.body ?? '').toLowerCase()
      const typeLabel = t.task_type ? TASK_TYPE_LABEL[t.task_type].toLowerCase() : ''
      return title.includes(q) || body.includes(q) || typeLabel.includes(q)
    })
  }, [sorted, taskQuery, typeFilter, completionFilter])

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
    setLoadClientData(null)
    setPendingClient(null)
    setFiles([])
  }, [])

  const applyClientSelection = useCallback((client: NmHubMayoristaClient) => {
    setTitle(client.full_name)
    setPendingClient(client)
    setClientDni('')
    setClientPhone('')
    setClientEmail('')
    setClientAddress('')
    setLoadClientData(null)
    setClientSuggestOpen(false)
  }, [])

  const chooseLoadClientData = useCallback(
    (choice: 'yes' | 'no') => {
      setLoadClientData(choice)
      if (choice === 'yes' && pendingClient) {
        setClientDni(pendingClient.dni)
        setClientPhone(pendingClient.phone)
        setClientEmail(pendingClient.email)
        setClientAddress(pendingClient.address)
      }
      if (choice === 'no') {
        setClientDni('')
        setClientPhone('')
        setClientEmail('')
        setClientAddress('')
      }
    },
    [pendingClient],
  )

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

  const openTrackingEditor = useCallback((t: NmHubTask) => {
    setTrackingEditTask(t)
    setTrackingDraft(t.tracking_url ?? '')
    setError(null)
  }, [])

  const closeEditTask = useCallback(() => {
    setEditTask(null)
    setEditTitle('')
    setEditBody('')
    setEditTracking('')
    setEditKeptPaths([])
    setEditNewFiles([])
    setEditImageUrls({})
  }, [])

  const openEditTask = useCallback((t: NmHubTask) => {
    setEditTask(t)
    setEditTitle(t.title)
    setEditBody(t.body ?? '')
    setEditTracking(t.tracking_url ?? '')
    setEditKeptPaths([...(t.image_paths ?? [])])
    setEditNewFiles([])
    setEditImageUrls({})
    setError(null)
  }, [])

  useEffect(() => {
    if (!editTask || editKeptPaths.length === 0) {
      setEditImageUrls({})
      return
    }
    let cancelled = false
    const run = async () => {
      const next: Record<string, string> = {}
      for (const p of editKeptPaths) {
        const u = await signedImageUrl(p)
        if (u) next[p] = u
      }
      if (!cancelled) setEditImageUrls(next)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [editTask, editKeptPaths])

  const onSaveEditTask = async () => {
    if (readOnly || !editTask) return
    const titleTrim = editTitle.trim()
    if (!titleTrim) {
      setError('El título no puede estar vacío.')
      return
    }
    const hadTracking = Boolean(editTask.tracking_url?.trim())
    let trackingNormalized: string | null = null
    if (hadTracking) {
      trackingNormalized = normalizeExternalUrl(editTracking)
      if (editTracking.trim() && !trackingNormalized) {
        setError('Pegá un link de seguimiento válido, o vaciá el campo para quitarlo.')
        return
      }
    } else {
      trackingNormalized = editTask.tracking_url ?? null
    }
    for (const file of editNewFiles) {
      const imgErr = validateHubTaskImageFile(file)
      if (imgErr) {
        setError(imgErr)
        return
      }
    }

    setBusy(true)
    setError(null)
    markLocalHubMutation()
    try {
      let updated = await updateHubTask(editTask.id, {
        title: titleTrim,
        body: editBody.trim() || null,
        trackingUrl: trackingNormalized,
      })

      const originalPaths = editTask.image_paths ?? []
      const kept = editKeptPaths
      const removed = originalPaths.filter((p) => !kept.includes(p))

      if (removed.length > 0) {
        updated = await replaceHubTaskImages(editTask.id, kept, originalPaths)
      }
      if (editNewFiles.length > 0) {
        const uploaded = await appendTaskImages(editTask.id, editNewFiles, kept)
        updated = { ...updated, image_paths: [...kept, ...uploaded] }
      }

      patchTaskLocal(updated)
      closeEditTask()
    } catch (err: unknown) {
      setError(formatSupabaseOrError(err))
      await loadSilent()
    } finally {
      setBusy(false)
    }
  }

  const onSaveTrackingUrl = async () => {
    if (readOnly || !trackingEditTask) return
    const normalized = normalizeExternalUrl(trackingDraft)
    if (trackingDraft.trim() && !normalized) {
      setError('Pegá un link válido (ej. https://www.andreani.com/?numero=...).')
      return
    }
    setBusy(true)
    setError(null)
    markLocalHubMutation()
    try {
      const updated = await updateHubTaskTrackingUrl(trackingEditTask.id, normalized)
      patchTaskLocal(updated)
      setTrackingEditTask(null)
      setTrackingDraft('')
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
    setLoadClientData(null)
    setPendingClient(null)
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
    if (readOnly || !title.trim() || !taskCreateType) return
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
    const shouldSaveClient =
      taskTypeUsesClientFields(taskCreateType) && loadClientData === 'yes'

    try {
      // Solo se recuerda cliente si el usuario eligió «Sí» y completó los datos.
      // Con «No» / omitir: la tarea se crea sin upsert en mayorista_clients.
      if (shouldSaveClient) {
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

      const assignedTo = await resolveAssignedToUserId(DEFAULT_ASSIGNED_ROLE)
      const created = await createHubTask({
        title: titleDraft,
        body: finalBody,
        importance: finalImportance,
        for_date: todayIsoLocal(),
        assigned_role: DEFAULT_ASSIGNED_ROLE,
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

  const goListPanel = useCallback(() => {
    resetCreateForm()
    replaceListPanelUrl()
    setPanel('list')
  }, [resetCreateForm])

  return (
    <div className="nm-hub-app nm-hub-app--tasks">
      <header className="nm-hub-header dashboard-navbar">
        <HubBrandBar integratedDashboard adminSignOut={isAdmin} />
      </header>

      <HubDesktopNav role={profileRole} />

      {error ? (
        <p className="nm-hub-error" role="alert">
          {error}
        </p>
      ) : null}

      {!readOnly && panel === 'create' ? (
        <form id="nm-hub-tareas-nueva" className="nm-hub-card nm-hub-card--task-create" onSubmit={(e) => void onCreate(e)}>
          <header className="hub-page-head hub-page-head--with-action">
            <div className="hub-page-head__main">
              <button type="button" className="hub-page-back" onClick={goListPanel}>
                ‹ Tareas
              </button>
              <h1 className="hub-page-head__title">Nueva tarea</h1>
              <p className="hub-page-head__lead">
                Elegí el tipo y cargá los datos del pedido o cambio.
              </p>
            </div>
          </header>
          <div className="form-container-clean">
          <div className="field-group">
            <span className="field-label" id="nm-hub-t-type-label">
              Tipo de tarea
            </span>
            <div
              className={`task-create-preset-row${taskCreateType ? ' task-create-preset-row--has-selection' : ''}`}
              role="group"
              aria-labelledby="nm-hub-t-type-label"
            >
              {TASK_CREATE_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`task-create-preset-btn task-create-preset-btn--${type}${taskCreateType === type ? ' task-create-preset-btn--active' : ''}${taskCreateType && taskCreateType !== type ? ' task-create-preset-btn--dimmed' : ''}`}
                  onClick={() => applyTaskType(type)}
                  disabled={busy}
                  aria-pressed={taskCreateType === type}
                >
                  {taskCreateType === type ? '✓ ' : ''}
                  {TASK_TYPE_LABEL[type]}
                </button>
              ))}
              <button
                type="button"
                className={`task-create-preset-btn task-create-preset-btn--crear-cliente${taskCreateType ? ' task-create-preset-btn--dimmed' : ''}`}
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
                onChange={(e) => {
                  const next = e.target.value
                  setTitle(next)
                  if (!next.trim()) {
                    setLoadClientData(null)
                    setPendingClient(null)
                    setClientDni('')
                    setClientPhone('')
                    setClientEmail('')
                    setClientAddress('')
                  }
                }}
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

          {taskTypeUsesClientFields(taskCreateType) && title.trim() ? (
            <div className="field-group task-create-client-choice">
              <span className="field-label" id="nm-hub-t-client-data-label">
                ¿Cargar datos del cliente?
              </span>
              <div
                className="task-create-client-choice__row"
                role="group"
                aria-labelledby="nm-hub-t-client-data-label"
              >
                <button
                  type="button"
                  className={`task-create-preset-btn${loadClientData === 'yes' ? ' task-create-preset-btn--active' : ''}`}
                  onClick={() => chooseLoadClientData('yes')}
                  disabled={busy}
                  aria-pressed={loadClientData === 'yes'}
                >
                  Sí
                </button>
                <button
                  type="button"
                  className={`task-create-preset-btn${loadClientData === 'no' ? ' task-create-preset-btn--active' : ''}`}
                  onClick={() => chooseLoadClientData('no')}
                  disabled={busy}
                  aria-pressed={loadClientData === 'no'}
                >
                  No
                </button>
              </div>
            </div>
          ) : null}

          {taskTypeUsesClientFields(taskCreateType) && loadClientData === 'yes' ? (
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
            <div
              className={`nm-hub-image-picker upload-zone-rebel${imageDragOver ? ' upload-zone-rebel--dragover' : ''}`}
              role="group"
              aria-labelledby="nm-hub-t-files-legend nm-hub-t-files-title"
              onDragEnter={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setImageDragOver(true)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setImageDragOver(true)
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const related = e.relatedTarget as Node | null
                if (related && e.currentTarget.contains(related)) return
                setImageDragOver(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setImageDragOver(false)
                appendImageFiles(e.dataTransfer.files)
              }}
            >
              <p className="nm-hub-image-picker-title upload-zone-title" id="nm-hub-t-files-title">
                Cargar imagen
              </p>
              <p className="upload-zone-hint">Arrastrá imágenes acá, o elegí galería / cámara</p>
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
              <ul className="nm-hub-create-file-list nm-hub-create-file-list--previews" aria-label="Imágenes seleccionadas">
                {files.map((file, idx) => (
                  <li key={`${file.name}-${file.size}-${file.lastModified}-${idx}`} className="nm-hub-create-file-row nm-hub-create-file-row--preview">
                    {filePreviewUrls[idx] ? (
                      <img
                        src={filePreviewUrls[idx]}
                        alt=""
                        className="nm-hub-create-file-thumb"
                      />
                    ) : null}
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
            disabled={
              busy ||
              !taskCreateType ||
              (taskTypeUsesClientFields(taskCreateType) && Boolean(title.trim()) && loadClientData === null)
            }
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
        <section id="nm-hub-tareas-lista" className="nm-hub-section nm-hub-section--task-list" aria-labelledby="hub-tasks-title">
          <header className="hub-page-head hub-page-head--with-action">
            <div className="hub-page-head__main">
              <h1 id="hub-tasks-title" className="hub-page-head__title">
                Tareas
              </h1>
            </div>
            {!readOnly ? (
              <button
                type="button"
                className="hub-page-primary-action"
                onClick={() => goCreatePanel()}
              >
                Nueva tarea
              </button>
            ) : null}
          </header>

          <div className="hub-tasks-toolbar">
            <div className="hub-tasks-month-bar" aria-label="Mes">
              <button
                type="button"
                className="nm-hub-btn nm-hub-btn-ghost"
                onClick={() => applyMonth(addMonthsToYearMonth(yearMonth, -1))}
                aria-label="Mes anterior"
              >
                ‹
              </button>
              <h2 className="hub-tasks-month-title">{formatMonthYearLabel(yearMonth)}</h2>
              <button
                type="button"
                className="nm-hub-btn nm-hub-btn-ghost"
                onClick={() => applyMonth(addMonthsToYearMonth(yearMonth, 1))}
                aria-label="Mes siguiente"
              >
                ›
              </button>
            </div>

            <div className="hub-tasks-filters" role="search">
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

              <div className="hub-tasks-filter-field">
                <label className="nm-hub-sr-only" htmlFor="nm-hub-task-type-filter">
                  Filtrar por tipo
                </label>
                <select
                  id="nm-hub-task-type-filter"
                  className="hub-tasks-filter-select"
                  value={typeFilter}
                  onChange={(e) =>
                    setTypeFilter(e.target.value as HubTaskCreateType | 'all')
                  }
                >
                  <option value="all">Todos los tipos</option>
                  {TASK_FILTER_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {TASK_TYPE_LABEL[type]}
                    </option>
                  ))}
                </select>
              </div>

              <div
                className="hub-tasks-completion-seg"
                role="group"
                aria-label="Filtrar por estado de completado"
              >
                {(
                  [
                    { value: 'all', label: 'Todas' },
                    { value: 'pending', label: 'Pendientes' },
                    { value: 'completed', label: 'Completadas' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`hub-tasks-completion-seg__btn${
                      completionFilter === opt.value
                        ? ' hub-tasks-completion-seg__btn--active'
                        : ''
                    }`}
                    aria-pressed={completionFilter === opt.value}
                    onClick={() => setCompletionFilter(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loading && rawTasks.length === 0 ? (
            <p className="nm-hub-muted">Cargando…</p>
          ) : null}
          {!loading && monthTasks.length === 0 ? (
            <p className="nm-hub-muted">No hay tareas en {formatMonthYearLabel(yearMonth)}.</p>
          ) : null}
          {!loading && monthTasks.length > 0 && filteredSorted.length === 0 ? (
            <p className="nm-hub-muted">Ninguna tarea coincide con los filtros.</p>
          ) : null}
          <div className="hub-tasks-table-wrap" aria-busy={loading}>
            <table className="hub-tasks-table">
              <thead>
                <tr>
                  <th scope="col" className="hub-tasks-table__col-tipo">
                    Tipo
                  </th>
                  <th scope="col" className="hub-tasks-table__col-title">
                    Título
                  </th>
                  <th scope="col" className="hub-tasks-table__col-detail">
                    Detalle
                  </th>
                  <th scope="col" className="hub-tasks-table__col-status">
                    Estado
                  </th>
                  <th scope="col" className="hub-tasks-table__col-payment">
                    Pago
                  </th>
                  <th scope="col" className="hub-tasks-table__col-created">
                    Creada
                  </th>
                  <th scope="col" className="hub-tasks-table__col-images">
                    Imagen
                  </th>
                  <th scope="col" className="hub-tasks-table__col-tracking">
                    Seguimiento
                  </th>
                  <th scope="col" className="hub-tasks-table__col-actions">
                    <span className="nm-hub-sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredSorted.map((t, rowIndex) => {
                  const expanded = expandedDetailIds.has(t.id)
                  const workflow = t.workflow_status ?? 'sin_ingresar'
                  const payment = t.payment_status ?? 'sin_pagar'
                  const completed = isHubTaskCompleted(t)
                  const orderNumber = parseShopifyOrderNumberFromTitle(t.title)
                  const shopifyUrl = orderNumber ? (shopifyUrlsByOrder[orderNumber] ?? null) : null
                  const zebra = rowIndex % 2 === 0 ? 'hub-tasks-table__row--odd' : 'hub-tasks-table__row--even'
                  const rowClass = `hub-tasks-table__row ${zebra}${completed ? ' hub-tasks-table__row--completed' : ' hub-tasks-table__row--pending'}`
                  return (
                    <Fragment key={t.id}>
                      <tr className={rowClass}>
                        <td className="hub-tasks-table__tipo">
                          {t.task_type ? (
                            <span className={`task-type-badge task-type-badge--${t.task_type}`}>
                              {TASK_TYPE_LABEL[t.task_type]}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="hub-tasks-table__title">
                          {shopifyUrl ? (
                            <a
                              className="hub-tasks-table__title-link"
                              href={shopifyUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Abrir orden Shopify ${orderNumber ?? t.title}`}
                              title={`Abrir en Shopify (#${orderNumber})`}
                            >
                              {t.title}
                            </a>
                          ) : (
                            <span
                              className={
                                orderNumber
                                  ? 'hub-tasks-table__title-text hub-tasks-table__title-text--unresolved'
                                  : 'hub-tasks-table__title-text'
                              }
                              title={
                                orderNumber
                                  ? 'No se encontró la orden en Shopify'
                                  : t.title
                              }
                            >
                              {t.title}
                            </span>
                          )}
                        </td>
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
                        <td className="hub-tasks-table__status">
                          <HubTasksPillSelect
                            value={workflow}
                            options={WORKFLOW_STATUS_OPTIONS}
                            disabled={busy || readOnly}
                            aria-label={`Estado de ${t.title}`}
                            onChange={(status) => void onWorkflowChange(t, status)}
                          />
                        </td>
                        <td className="hub-tasks-table__payment">
                          <HubTasksPillSelect
                            value={payment}
                            options={PAYMENT_STATUS_OPTIONS}
                            disabled={busy || readOnly}
                            aria-label={`Pago de ${t.title}`}
                            onChange={(status) => void onPaymentChange(t, status)}
                          />
                        </td>
                        <td className="hub-tasks-table__created">{formatTaskCreatedAt(t.created_at)}</td>
                        <td className="hub-tasks-table__images">
                          {completed && (t.image_paths?.length ?? 0) > 0 ? (
                            <TaskThumbnails paths={t.image_paths ?? []} rebel compact />
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="hub-tasks-table__tracking">
                          {(() => {
                            const href = trackingHref(t.tracking_url)
                            return (
                              <div className="hub-tasks-tracking-cell">
                                {href ? (
                                  <a
                                    className="hub-tasks-tracking-link"
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={href}
                                  >
                                    Seguimiento
                                  </a>
                                ) : !readOnly ? (
                                  <button
                                    type="button"
                                    className="hub-tasks-tracking-edit"
                                    disabled={busy}
                                    onClick={() => openTrackingEditor(t)}
                                  >
                                    Cargar link
                                  </button>
                                ) : (
                                  '—'
                                )}
                              </div>
                            )
                          })()}
                        </td>
                        <td className="hub-tasks-table__col-actions">
                          <div className="hub-tasks-table__row-actions">
                            {!readOnly ? (
                              <button
                                type="button"
                                className="hub-tasks-edit-btn hub-tasks-table__action-btn"
                                disabled={busy}
                                onClick={() => openEditTask(t)}
                              >
                                Editar
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="btn-task-notes hub-tasks-table__action-btn"
                              onClick={() => setNotesTask(t)}
                              aria-label={
                                noteCounts[t.id]
                                  ? `Notas, ${noteCounts[t.id]}`
                                  : 'Notas'
                              }
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
                          className={`hub-tasks-table__detail-row ${zebra}${completed ? ' hub-tasks-table__detail-row--completed' : ''}`}
                        >
                          <td colSpan={9}>
                            <div className="hub-tasks-table__detail-panel">
                              <div className="hub-tasks-table__detail-body">{t.body}</div>
                              {(t.image_paths?.length ?? 0) > 0 ? (
                                <TaskThumbnails paths={t.image_paths ?? []} rebel />
                              ) : null}
                            </div>
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

      {editTask ? (
        <div
          className="nm-prod-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) closeEditTask()
          }}
        >
          <section
            className="nm-prod-modal hub-tasks-edit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hub-edit-task-title"
          >
            <h3 className="nm-prod-modal-title" id="hub-edit-task-title">
              Editar tarea
            </h3>

            <div className="hub-tasks-edit-modal__fields">
              <div className="field-group">
                <label className="field-label" htmlFor="hub-edit-title">
                  Título
                </label>
                <input
                  id="hub-edit-title"
                  className="nm-hub-input field-input"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  disabled={busy}
                  required
                />
              </div>

              <div className="field-group">
                <label className="field-label" htmlFor="hub-edit-body">
                  Detalle
                </label>
                <textarea
                  id="hub-edit-body"
                  className="nm-hub-textarea field-textarea"
                  rows={5}
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  disabled={busy}
                />
              </div>

              {editTask.tracking_url ? (
                <div className="field-group">
                  <label className="field-label" htmlFor="hub-edit-tracking">
                    Seguimiento
                  </label>
                  <input
                    id="hub-edit-tracking"
                    className="nm-hub-input field-input"
                    type="text"
                    inputMode="url"
                    placeholder="https://www.andreani.com/?numero=..."
                    value={editTracking}
                    onChange={(e) => setEditTracking(e.target.value)}
                    disabled={busy}
                  />
                  {trackingHref(editTracking) ? (
                    <p className="hub-tasks-tracking-preview">
                      Link:{' '}
                      <a
                        href={trackingHref(editTracking) ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {trackingHref(editTracking)}
                      </a>
                    </p>
                  ) : editTracking.trim() ? (
                    <p className="hub-tasks-tracking-preview hub-tasks-tracking-preview--warn">
                      No se detectó un link válido. Vaciá el campo para quitar el seguimiento.
                    </p>
                  ) : (
                    <p className="hub-tasks-tracking-preview">
                      Campo vacío: se quitará el link al guardar.
                    </p>
                  )}
                </div>
              ) : null}

              <div className="field-group">
                <span className="field-label">Imágenes</span>
                {editKeptPaths.length > 0 ? (
                  <ul className="hub-tasks-edit-images">
                    {editKeptPaths.map((path) => (
                      <li key={path} className="hub-tasks-edit-images__item">
                        {editImageUrls[path] ? (
                          <img
                            src={editImageUrls[path]}
                            alt=""
                            className="hub-tasks-edit-images__thumb"
                          />
                        ) : (
                          <span className="hub-tasks-edit-images__placeholder" aria-hidden />
                        )}
                        <button
                          type="button"
                          className="hub-tasks-edit-images__remove"
                          disabled={busy}
                          onClick={() =>
                            setEditKeptPaths((prev) => prev.filter((p) => p !== path))
                          }
                        >
                          Quitar
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="nm-hub-muted hub-tasks-edit-images__empty">Sin imágenes.</p>
                )}
                <label className="hub-tasks-edit-images__add">
                  <span>Agregar imagen</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={busy}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      const list = e.target.files
                      if (!list?.length) return
                      const next = Array.from(list)
                      setEditNewFiles((prev) => [...prev, ...next])
                      e.target.value = ''
                    }}
                  />
                </label>
                {editNewFiles.length > 0 ? (
                  <ul className="hub-tasks-edit-images__pending">
                    {editNewFiles.map((file, idx) => (
                      <li key={`${file.name}-${idx}`}>
                        <span>{file.name}</span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setEditNewFiles((prev) => prev.filter((_, i) => i !== idx))
                          }
                        >
                          Quitar
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>

            <div className="nm-prod-row" style={{ marginTop: '1rem' }}>
              <button type="button" className="nm-prod-btn" disabled={busy} onClick={closeEditTask}>
                Cancelar
              </button>
              <button
                type="button"
                className="nm-prod-btn nm-prod-btn-primary"
                disabled={busy || !editTitle.trim()}
                onClick={() => void onSaveEditTask()}
              >
                {busy ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {trackingEditTask ? (
        <div
          className="nm-prod-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setTrackingEditTask(null)
              setTrackingDraft('')
            }
          }}
        >
          <section className="nm-prod-modal" role="dialog" aria-modal="true" aria-labelledby="hub-tracking-title">
            <h3 className="nm-prod-modal-title" id="hub-tracking-title">
              Cargar link de seguimiento
            </h3>
            <p className="nm-prod-modal-text">
              Pegá el link de seguimiento de «{trackingEditTask.title}» (ej. Andreani).
            </p>
            <label className="nm-hub-sr-only" htmlFor="hub-tracking-url">
              URL de seguimiento
            </label>
            <input
              id="hub-tracking-url"
              className="nm-hub-input field-input"
              type="text"
              inputMode="url"
              placeholder="https://www.andreani.com/?numero=..."
              value={trackingDraft}
              onChange={(e) => setTrackingDraft(e.target.value)}
              disabled={busy}
              autoFocus
            />
            {trackingHref(trackingDraft) ? (
              <p className="hub-tasks-tracking-preview">
                Link detectado:{' '}
                <a
                  href={trackingHref(trackingDraft) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {trackingHref(trackingDraft)}
                </a>
              </p>
            ) : trackingDraft.trim() ? (
              <p className="hub-tasks-tracking-preview hub-tasks-tracking-preview--warn">
                No se detectó un link válido. Pegá una URL completa.
              </p>
            ) : null}
            <div className="nm-prod-row" style={{ marginTop: '1rem' }}>
              <button
                type="button"
                className="nm-prod-btn"
                disabled={busy}
                onClick={() => {
                  setTrackingEditTask(null)
                  setTrackingDraft('')
                }}
              >
                Cancelar
              </button>
              {trackingEditTask.tracking_url || trackingDraft.trim() ? (
                <button
                  type="button"
                  className="nm-prod-btn"
                  disabled={busy}
                  onClick={() => {
                    setTrackingDraft('')
                    void (async () => {
                      if (readOnly || !trackingEditTask) return
                      setBusy(true)
                      setError(null)
                      markLocalHubMutation()
                      try {
                        const updated = await updateHubTaskTrackingUrl(trackingEditTask.id, null)
                        patchTaskLocal(updated)
                        setTrackingEditTask(null)
                        setTrackingDraft('')
                      } catch (err: unknown) {
                        setError(formatSupabaseOrError(err))
                        await loadSilent()
                      } finally {
                        setBusy(false)
                      }
                    })()
                  }}
                >
                  Quitar link
                </button>
              ) : null}
              <button
                type="button"
                className="nm-prod-btn nm-prod-btn-primary"
                disabled={busy}
                onClick={() => void onSaveTrackingUrl()}
              >
                {busy ? 'Guardando…' : 'Guardar'}
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
