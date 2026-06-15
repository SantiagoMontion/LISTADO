import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CutStripPlanView } from './components/CutStripPlanView'
import { MaterialMetersLine } from './components/MaterialMetersLine'
import { CreadorMaterialImagesModal } from './components/CreadorMaterialImagesModal'
import { QuickAddMeasureModal } from './components/QuickAddMeasureModal'
import { HubDispatchedOrdersApp } from './components/HubDispatchedOrdersApp'
import { HubAdminCutAnalytics } from './components/HubAdminCutAnalytics'
import { HubAdminDispatchAnalytics } from './components/HubAdminDispatchAnalytics'
import { HubDispatchedStatsApp } from './components/HubDispatchedStatsApp'
import { HubPrintedFilesApp } from './components/HubPrintedFilesApp'
import { MaterialTabs } from './components/MaterialTabs'
import { TaskCard } from './components/TaskCard'
import {
  canAccessHubPath,
  getHubPermissions,
  hubPathBlockedMessage,
} from './lib/hubPermissions'
import { canDeleteManejadorReport, canEditManejadorList, hubTasksReadOnly } from './lib/hubRoles'
import { HubEntrarRedirect } from './components/HubEntrarRedirect'
import { HubHome } from './components/HubHome'
import { HubBrandBar } from './components/HubBrandBar'
import { HubLoadingScreen } from './components/HubLoadingScreen'
import { HubRoleBlocked } from './components/HubRoleBlocked'
import { HubTasksApp } from './components/HubTasksApp'
import { HubTaskPushListener } from './components/HubTaskPushListener'
import { LoginPage } from './components/LoginPage'
import { HUB_NAV_EVENT, onHubLinkClick } from './lib/hubNavigate'
import { normalizeCalendarDate, todayIsoLocal } from './lib/date'
import { formatSupabaseOrError } from './lib/errors'
import { parseProductionReport } from './lib/parseReport'
import {
  buildOperatorCutPlan,
  computePlanchaSummaryFromTasks,
  computeRollLengthCmFromTasks,
  formatPlanchaHint,
} from './lib/buildOperatorCutPlan'
import {
  firstPendingMoldSource,
  lastCutMoldSource,
  mergeMoldTasksByMeasure,
  splitMoldAndPlanTasks,
} from './lib/moldMeasures'
import { ROLL_WIDTH_BY_TAB } from './lib/guillotineStripPack'
import { sortTasksForDisplay } from './lib/sortTasks'
import { surfaceFromDimensions } from './lib/surface'
import {
  createReportWithTasks,
  importTasksIntoDay,
  mergeTaskIntoReport,
  decrementTaskQty,
  deleteReportCompletely,
  fetchReportsWithTasksProgress,
  fetchTasks,
  incrementTaskQty,
  fetchAllPendingTasks,
  supabase,
  toggleTaskCompleted,
  toggleTaskPriority,
} from './lib/supabase'
import type { MaterialTab, NmHubProfile, NmProdReport, NmProdTask } from './lib/types'
import { useAuth } from './lib/useAuth'

function hubTaskPushListener(profile: NmHubProfile | null | undefined) {
  if (!profile || !getHubPermissions(profile.role)?.viewHubTasks) return null
  return (
    <HubTaskPushListener
      profileRole={profile.role}
      profileId={profile.id}
      isAdmin={profile.role === 'admin'}
    />
  )
}

const TAB_ORDER: MaterialTab[] = [
  'classic',
  'pro',
  'alfombras',
  'bordes_rectos',
  'mayorista',
  'otros',
]

function isMaterialTab(v: string): v is MaterialTab {
  return (TAB_ORDER as string[]).includes(v)
}

function tabForMaterialType(v: string): MaterialTab {
  return isMaterialTab(v) ? v : 'otros'
}

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const base = new Date(year, month - 1, day)
  base.setDate(base.getDate() + days)
  const y = base.getFullYear()
  const m = String(base.getMonth() + 1).padStart(2, '0')
  const d = String(base.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatDayMonth(isoDate: string): string {
  const [_, month, day] = isoDate.split('-')
  return `${Number(day)}/${Number(month)}`
}

type TaskFilter = 'all' | 'priority' | 'standard' | 'completed'
const STANDARD_DIMENSIONS = new Set(['90x40', '82x32', '50x40'])
function matchesTaskFilter(task: NmProdTask, filter: TaskFilter): boolean {
  const done = task.is_completed || task.current_qty >= task.total_qty
  if (filter === 'completed') return done
  if (filter === 'priority') return task.is_priority && !done
  if (filter === 'standard') return STANDARD_DIMENSIONS.has(task.dimensions.trim()) && !done
  return !done
}

function reportStorageKey(fecha: string): string {
  return `nm_prod_report_${normalizeCalendarDate(fecha)}`
}

/** Lista «Cortados»: texto en medida (título de fila) o en notas (descripción). */
function nmProdTaskMatchesCompletedSearch(task: NmProdTask, q: string): boolean {
  if (!q) return true
  const d = task.dimensions.toLowerCase()
  const n = (task.notes ?? '').toLowerCase()
  return d.includes(q) || n.includes(q)
}

/** Menor = más relevante al ordenar con búsqueda activa. */
function nmProdCompletedSearchRank(task: NmProdTask, q: string): number {
  if (!q) return 0
  const d = task.dimensions.toLowerCase()
  const n = (task.notes ?? '').toLowerCase()
  if (d === q) return 0
  if (d.startsWith(q)) return 1
  if (d.includes(q)) return 2
  if (n.includes(q)) return 3
  return 4
}


function tabbedTasksForOrdenar(
  tasksByMainFilter: NmProdTask[],
  activeTab: MaterialTab,
  taskFilter: TaskFilter,
  completedSearch: string,
): NmProdTask[] {
  const tabbed = tasksByMainFilter.filter(
    (t) => tabForMaterialType(t.material_type) === activeTab,
  )
  const q = completedSearch.trim().toLowerCase()
  if (taskFilter === 'completed') {
    return tabbed.filter((t) => nmProdTaskMatchesCompletedSearch(t, q))
  }
  return tabbed
}

export default function App() {
  const configured = Boolean(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
  )
  const { session, user, profile, profileReady, profileError, ready: authReady } = useAuth()
  const authEnabled = configured && Boolean(supabase)

  const [navTick, setNavTick] = useState(0)
  useEffect(() => {
    const bump = () => setNavTick((n) => n + 1)
    window.addEventListener('popstate', bump)
    window.addEventListener(HUB_NAV_EVENT, bump as EventListener)
    return () => {
      window.removeEventListener('popstate', bump)
      window.removeEventListener(HUB_NAV_EVENT, bump as EventListener)
    }
  }, [])

  const path = useMemo(() => {
    let p = (window.location.pathname || '/').toLowerCase()
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
    return p
  }, [navTick])
  const isLogin = path === '/entrar'
  const isHubTasks = path === '/tareas'
  const isHubPrintedFiles = path === '/archivos-impresos'
  const isHubDispatchedCargar = path === '/pedidos-despachados/cargar'
  const isHubDispatchedAnalytics = path === '/pedidos-despachados/analitica'
  const isHubCutAnalytics = path === '/lista-corte/analitica'
  const isHubDispatchedCalendar =
    path === '/pedidos-despachados' || path === '/pedidos-despachados/estadisticas'
  const isHubHome = path === '/' || path === ''

  const [reports, setReports] = useState<NmProdReport[]>([])
  const [reportId, setReportId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<NmProdTask[]>([])
  const [tasksLoaded, setTasksLoaded] = useState(false)
  const [paste, setPaste] = useState('')
  const [activeTab, setActiveTab] = useState<MaterialTab>('classic')
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const mode: 'home' | 'creator' | 'manager' =
    path === '/creador' ? 'creator' : path === '/manejador' ? 'manager' : 'home'
  const canEditTasks =
    mode === 'manager' &&
    (!authEnabled || !profileReady || !profile || canEditManejadorList(profile.role))
  const canImportReports =
    mode === 'creator' &&
    (!authEnabled || !profileReady || !profile || getHubPermissions(profile.role)?.uploadProductionList)
  const showCreadorMaterialImages =
    configured &&
    authEnabled &&
    profileReady &&
    getHubPermissions(profile?.role)?.uploadMaterialImages &&
    mode === 'creator'
  const canDeleteReports =
    mode === 'manager' &&
    (!authEnabled || !profileReady || !profile || canDeleteManejadorReport(profile.role))
  const [selectedDate, setSelectedDate] = useState(todayIsoLocal)
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all')
  const [completedSearch, setCompletedSearch] = useState('')
  const [completedAtById, setCompletedAtById] = useState<Record<string, number>>({})
  const [pendingCutTask, setPendingCutTask] = useState<NmProdTask | null>(null)
  const [pendingDeleteReportId, setPendingDeleteReportId] = useState<string | null>(null)
  const [pendingQuickAdd, setPendingQuickAdd] = useState(false)
  const [quickAddError, setQuickAddError] = useState<string | null>(null)
  const [pendingDates, setPendingDates] = useState<Set<string>>(new Set())
  const [materialImgModalOpen, setMaterialImgModalOpen] = useState(false)
  const [stripPackSortActive, setStripPackSortActive] = useState(false)
  const [mergeAllListsChecked, setMergeAllListsChecked] = useState(false)
  const [allPendingTasks, setAllPendingTasks] = useState<NmProdTask[]>([])
  const [allPendingTasksLoading, setAllPendingTasksLoading] = useState(false)

  useEffect(() => {
    if (!showCreadorMaterialImages || path !== '/creador') return
    const u = new URL(window.location.href)
    if (u.searchParams.get('subir') !== 'imagenes') return
    setMaterialImgModalOpen(true)
    u.searchParams.delete('subir')
    const q = u.searchParams.toString()
    window.history.replaceState(null, '', `${u.pathname}${q ? `?${q}` : ''}${u.hash}`)
    window.dispatchEvent(new CustomEvent(HUB_NAV_EVENT))
  }, [navTick, path, showCreadorMaterialImages])

  /** Solo aplica el último refresh en vuelo; si uno viejo termina después, no pisa reports/pendingDates (el "!" quedaba pegado). */
  const reportsRefreshSeqRef = useRef(0)
  /** Evita aplicar `fetchTasks` viejo si el usuario ya cambió de lista o de día (race async). */
  const reportIdForTasksRef = useRef<string | null>(null)
  reportIdForTasksRef.current = reportId
  /** Realtime + mutaciones pueden solapar fetchTasks; el que termina último no debe pisar datos nuevos. */
  const tasksLoadSeqRef = useRef(0)
  const loadTasksDebounceRef = useRef<number | null>(null)
  /** Tras un corte propio, ignorar realtime breve (ya está el patch local). */
  const suppressRealtimeUntilRef = useRef(0)

  const refreshReports = useCallback(async () => {
    if (!configured) return
    const seq = ++reportsRefreshSeqRef.current
    const { reports: list, pendingFechas } = await fetchReportsWithTasksProgress()
    if (seq !== reportsRefreshSeqRef.current) return

    setReports(list)
    setPendingDates(new Set(pendingFechas))
  }, [configured])

  const pendingReportsRefreshRef = useRef<number | null>(null)
  const scheduleRefreshReports = useCallback(() => {
    if (pendingReportsRefreshRef.current !== null) {
      window.clearTimeout(pendingReportsRefreshRef.current)
    }
    pendingReportsRefreshRef.current = window.setTimeout(() => {
      pendingReportsRefreshRef.current = null
      void refreshReports().catch((e: unknown) => {
        setError(formatSupabaseOrError(e))
      })
    }, 350)
  }, [refreshReports])

  const refreshCurrentTasks = useCallback(async () => {
    if (!configured || !reportId) return
    const rid = reportId
    const seq = ++tasksLoadSeqRef.current
    const rows = await fetchTasks(rid)
    if (reportIdForTasksRef.current !== rid) return
    if (seq !== tasksLoadSeqRef.current) return
    setTasks(rows)
    setTasksLoaded(true)
  }, [configured, reportId])

  const patchTaskLocal = useCallback((taskId: string, updater: (t: NmProdTask) => NmProdTask) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? updater(t) : t)))
  }, [])

  const markTaskCompletedNow = useCallback((taskId: string) => {
    setCompletedAtById((prev) => ({ ...prev, [taskId]: Date.now() }))
  }, [])

  useEffect(() => {
    refreshReports().catch((e: unknown) => {
      setError(formatSupabaseOrError(e))
    })
  }, [refreshReports])

  useEffect(() => {
    if (!configured || mode !== 'manager') return
    void refreshReports().catch((e: unknown) => {
      setError(formatSupabaseOrError(e))
    })
  }, [selectedDate, configured, mode, refreshReports])

  const reportsForSelectedDate = useMemo(() => {
    const sel = normalizeCalendarDate(selectedDate)
    return reports
      .filter((r) => normalizeCalendarDate(r.fecha) === sel)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  }, [reports, selectedDate])

  const hasPendingBeforeSelectedDate = useMemo(() => {
    const sel = normalizeCalendarDate(selectedDate)
    for (const d of pendingDates) {
      if (normalizeCalendarDate(d) < sel) return true
    }
    return false
  }, [pendingDates, selectedDate])

  useEffect(() => {
    if (!reportId || reportsForSelectedDate.length === 0) return
    if (!reportsForSelectedDate.some((r) => r.id === reportId)) {
      setTasks([])
      setTasksLoaded(false)
    }
  }, [reportsForSelectedDate, reportId])

  useEffect(() => {
    const sb = supabase
    if (!configured || !reportId || !sb) {
      setTasks([])
      setTasksLoaded(false)
      return
    }

    let cancelled = false
    setTasksLoaded(false)

    const syncTasksFromServer = (opts?: { showLoading?: boolean }) => {
      const rid = reportId
      const seq = ++tasksLoadSeqRef.current
      if (opts?.showLoading) setTasksLoaded(false)
      return fetchTasks(rid)
        .then((rows) => {
          if (cancelled) return
          if (reportIdForTasksRef.current !== rid) return
          if (seq !== tasksLoadSeqRef.current) return
          setTasks(rows)
          setTasksLoaded(true)
        })
        .catch((e: unknown) => {
          if (cancelled || reportIdForTasksRef.current !== rid) return
          if (seq !== tasksLoadSeqRef.current) return
          setError(formatSupabaseOrError(e))
          setTasksLoaded(true)
        })
    }

    const scheduleSilentSync = () => {
      if (Date.now() < suppressRealtimeUntilRef.current) return
      if (loadTasksDebounceRef.current !== null) {
        window.clearTimeout(loadTasksDebounceRef.current)
      }
      loadTasksDebounceRef.current = window.setTimeout(() => {
        loadTasksDebounceRef.current = null
        void syncTasksFromServer().then(() => {
          scheduleRefreshReports()
        })
      }, 200)
    }

    void syncTasksFromServer({ showLoading: true })

    const channel = sb
      .channel(`nm_prod_tasks:${reportId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'nm_prod_tasks',
          filter: `report_id=eq.${reportId}`,
        },
        scheduleSilentSync,
      )
      .subscribe()

    return () => {
      cancelled = true
      if (loadTasksDebounceRef.current !== null) {
        window.clearTimeout(loadTasksDebounceRef.current)
        loadTasksDebounceRef.current = null
      }
      void sb.removeChannel(channel)
    }
  }, [configured, reportId, supabase, scheduleRefreshReports])

  const rollWidthForActiveTab = ROLL_WIDTH_BY_TAB[activeTab]
  const mergeAllListsActive = mergeAllListsChecked

  const reportFechaById = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of reports) {
      map.set(r.id, normalizeCalendarDate(r.fecha))
    }
    return map
  }, [reports])

  const listSourceTasks = mergeAllListsActive ? allPendingTasks : tasks

  const activeTabHasTasks = listSourceTasks.some(
    (t) => tabForMaterialType(t.material_type) === activeTab,
  )
  const showOrdenarBar =
    mode === 'manager' &&
    Boolean(reportId) &&
    tasksLoaded &&
    rollWidthForActiveTab !== undefined &&
    (activeTabHasTasks || stripPackSortActive)

  useEffect(() => {
    setStripPackSortActive(false)
    setMergeAllListsChecked(false)
  }, [reportId])

  useEffect(() => {
    if (!configured || mode !== 'manager' || !mergeAllListsActive) {
      setAllPendingTasksLoading(false)
      return
    }

    let cancelled = false
    setAllPendingTasksLoading(true)
    void fetchAllPendingTasks()
      .then((rows) => {
        if (cancelled) return
        setAllPendingTasks(rows)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(formatSupabaseOrError(e))
      })
      .finally(() => {
        if (!cancelled) setAllPendingTasksLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [configured, mode, mergeAllListsActive, reports])

  const tasksByMainFilter = useMemo(
    () => listSourceTasks.filter((t) => matchesTaskFilter(t, taskFilter)),
    [listSourceTasks, taskFilter],
  )

  const materialsAvailable = useMemo(() => {
    const present = new Set<MaterialTab>()
    for (const t of tasksByMainFilter) present.add(tabForMaterialType(t.material_type))
    return TAB_ORDER.filter((m) => present.has(m))
  }, [tasksByMainFilter])

  const counts = useMemo(() => {
    const c: Record<MaterialTab, number> = {
      classic: 0,
      pro: 0,
      alfombras: 0,
      bordes_rectos: 0,
      mayorista: 0,
      otros: 0,
    }
    for (const t of tasksByMainFilter) {
      c[tabForMaterialType(t.material_type)] += 1
    }
    return c
  }, [tasksByMainFilter])

  useEffect(() => {
    if (mode !== 'manager' || materialsAvailable.length === 0) return
    if (!materialsAvailable.includes(activeTab)) {
      setActiveTab(materialsAvailable[0])
    }
  }, [mode, materialsAvailable, activeTab])

  const ordenarInputTasks = useMemo(
    () => tabbedTasksForOrdenar(tasksByMainFilter, activeTab, taskFilter, completedSearch),
    [tasksByMainFilter, activeTab, taskFilter, completedSearch],
  )

  const { moldTasks, planTasks } = useMemo(
    () => splitMoldAndPlanTasks(ordenarInputTasks),
    [ordenarInputTasks],
  )

  const operatorCutPlan = useMemo(() => {
    if (!stripPackSortActive || rollWidthForActiveTab === undefined) return null
    return buildOperatorCutPlan(
      planTasks,
      rollWidthForActiveTab,
      taskFilter === 'completed',
    )
  }, [stripPackSortActive, rollWidthForActiveTab, planTasks, taskFilter])

  const mergedMoldGroups = useMemo(() => {
    if (!mergeAllListsActive) return null
    return mergeMoldTasksByMeasure(moldTasks)
  }, [mergeAllListsActive, moldTasks])

  const moldRollLengthCm = useMemo(() => {
    if (!stripPackSortActive || rollWidthForActiveTab === undefined) return 0
    return computeRollLengthCmFromTasks(
      moldTasks,
      rollWidthForActiveTab,
      taskFilter === 'completed',
    )
  }, [stripPackSortActive, rollWidthForActiveTab, moldTasks, taskFilter])

  const planRollLengthCm = useMemo(() => {
    if (!stripPackSortActive || rollWidthForActiveTab === undefined) return 0
    return computeRollLengthCmFromTasks(
      planTasks,
      rollWidthForActiveTab,
      taskFilter === 'completed',
    )
  }, [stripPackSortActive, rollWidthForActiveTab, planTasks, taskFilter])

  const moldPlanchaHints = useMemo(() => {
    if (!stripPackSortActive || rollWidthForActiveTab === undefined) {
      return new Map<string, string>()
    }
    const useCompleted = taskFilter === 'completed'
    const hints = new Map<string, string>()

    if (mergedMoldGroups) {
      for (const group of mergedMoldGroups) {
        const summary = computePlanchaSummaryFromTasks(
          group.sources,
          rollWidthForActiveTab,
          useCompleted,
        )
        if (summary) hints.set(group.measureKey, formatPlanchaHint(summary.groups))
      }
    } else {
      for (const t of moldTasks) {
        const summary = computePlanchaSummaryFromTasks([t], rollWidthForActiveTab, useCompleted)
        if (summary) hints.set(t.id, formatPlanchaHint(summary.groups))
      }
    }

    return hints
  }, [
    stripPackSortActive,
    rollWidthForActiveTab,
    mergedMoldGroups,
    moldTasks,
    taskFilter,
  ])

  const sortedMoldTasks = useMemo(() => sortTasksForDisplay(moldTasks), [moldTasks])

  const visibleTasks = useMemo(() => {
    if (stripPackSortActive) return ordenarInputTasks

    const q = completedSearch.trim().toLowerCase()
    const searched =
      taskFilter === 'completed'
        ? ordenarInputTasks.filter((t) => nmProdTaskMatchesCompletedSearch(t, q))
        : ordenarInputTasks

    if (taskFilter !== 'completed') {
      return sortTasksForDisplay(searched)
    }
    return [...searched].sort((a, b) => {
      if (q) {
        const ra = nmProdCompletedSearchRank(a, q)
        const rb = nmProdCompletedSearchRank(b, q)
        if (ra !== rb) return ra - rb
      }
      const timeA = completedAtById[a.id] ?? Date.parse(a.created_at)
      const timeB = completedAtById[b.id] ?? Date.parse(b.created_at)
      const byRecentCut = (Number.isFinite(timeB) ? timeB : 0) - (Number.isFinite(timeA) ? timeA : 0)
      if (byRecentCut !== 0) return byRecentCut
      return surfaceFromDimensions(b.dimensions) - surfaceFromDimensions(a.dimensions)
    })
  }, [
    ordenarInputTasks,
    taskFilter,
    completedSearch,
    completedAtById,
    stripPackSortActive,
  ])

  const allCutInActiveTab = useMemo(() => {
    if (taskFilter !== 'all') return false
    const tabTasks = tasks.filter(
      (t) => tabForMaterialType(t.material_type) === activeTab,
    )
    if (tabTasks.length === 0) return false
    return tabTasks.every((t) => t.is_completed || t.current_qty >= t.total_qty)
  }, [tasks, activeTab, taskFilter])

  /** Todo el reporte cargado (todas las pestañas); el aviso ! usa esto vía pendingDates. */
  const allCutEntireReport = useMemo(() => {
    if (taskFilter !== 'all') return false
    if (tasks.length === 0) return false
    return tasks.every((t) => t.is_completed || t.current_qty >= t.total_qty)
  }, [tasks, taskFilter])

  const hasPendingInOtherMaterialTab = useMemo(() => {
    if (taskFilter !== 'all') return false
    return tasks.some(
      (t) =>
        tabForMaterialType(t.material_type) !== activeTab &&
        !(t.is_completed || t.current_qty >= t.total_qty),
    )
  }, [tasks, activeTab, taskFilter])

  useEffect(() => {
    if (mode !== 'creator') return
    setReportId(null)
  }, [mode])

  useEffect(() => {
    if (mode === 'home' || mode === 'creator') return
    if (reportsForSelectedDate.length === 0) {
      setReportId(null)
      return
    }
    const idInDay = Boolean(reportId && reportsForSelectedDate.some((r) => r.id === reportId))
    if (idInDay) return

    const day = normalizeCalendarDate(selectedDate)
    let saved: string | null = null
    try {
      saved = sessionStorage.getItem(reportStorageKey(day))
    } catch {
      saved = null
    }
    if (saved && reportsForSelectedDate.some((r) => r.id === saved)) {
      setReportId(saved)
      return
    }
    // Mantener la lista más reciente del día aunque ya esté todo cortado (evita saltar a un 2.º reporte duplicado).
    setReportId(reportsForSelectedDate[0].id)
  }, [mode, reportsForSelectedDate, reportId, selectedDate])

  useEffect(() => {
    if (mode !== 'manager' || !reportId) return
    const day = normalizeCalendarDate(selectedDate)
    try {
      sessionStorage.setItem(reportStorageKey(day), reportId)
    } catch {
      /* quota / private mode */
    }
  }, [mode, reportId, selectedDate])

  useEffect(() => {
    if (!authEnabled) {
      if (isLogin) window.location.replace('/')
      return
    }
    if (!authReady) return
    if (isLogin && session) window.location.replace('/')
  }, [authEnabled, authReady, isLogin, session])

  useEffect(() => {
    if (!authEnabled || !authReady) return
    if (isLogin) return
    if (!session) window.location.replace('/entrar')
  }, [authEnabled, authReady, isLogin, session])

  const onImport = async () => {
    setError(null)
    setSuccess(null)
    const { fechaIso, sections } = parseProductionReport(paste)
    if (!fechaIso) {
      setError(
        'No se encontró la fecha en el texto. Incluí una línea como: ### REPORTE DE PRODUCCIÓN - 25/03/2026 ###',
      )
      return
    }
    const fecha = fechaIso
    const flat = sections.flatMap((s) =>
      s.items.map((it) => ({
        material_type: s.materialType,
        dimensions: it.dimensions,
        total_qty: it.totalQty,
        is_priority: it.is_priority ?? false,
        from_faltas: it.from_faltas ?? false,
      })),
    )
    if (flat.length === 0) {
      setError('No se detectaron ítems. Revisa separadores y líneas tipo 90x40 - 15.')
      return
    }
    setLoading(true)
    try {
      const { merged } = await importTasksIntoDay(fecha, flat)
      setPaste('')
      setSuccess(
        merged
          ? 'Lista actualizada en el día (se mantuvo el progreso de corte).'
          : 'Lista subida correctamente.',
      )
      await refreshReports()
    } catch (e: unknown) {
      setError(formatSupabaseOrError(e))
    } finally {
      setLoading(false)
    }
  }

  const markLocalListMutation = useCallback(() => {
    suppressRealtimeUntilRef.current = Date.now() + 900
  }, [])

  const onIncrement = async (task: NmProdTask) => {
    setBusyId(task.id)
    setError(null)
    markLocalListMutation()
    patchTaskLocal(task.id, (t) => ({
      ...t,
      current_qty: Math.min(t.current_qty + 1, t.total_qty),
      is_completed: t.current_qty + 1 >= t.total_qty ? true : t.is_completed,
    }))
    if (task.current_qty + 1 >= task.total_qty) {
      markTaskCompletedNow(task.id)
    }
    try {
      await incrementTaskQty(task)
      scheduleRefreshReports()
    } catch (e: unknown) {
      setError(formatSupabaseOrError(e))
      await refreshCurrentTasks()
    } finally {
      setBusyId(null)
    }
  }

  const onTogglePriority = async (task: NmProdTask) => {
    setBusyId(task.id)
    setError(null)
    markLocalListMutation()
    patchTaskLocal(task.id, (t) => ({ ...t, is_priority: !t.is_priority }))
    try {
      await toggleTaskPriority(task)
    } catch (e: unknown) {
      setError(formatSupabaseOrError(e))
      await refreshCurrentTasks()
    } finally {
      setBusyId(null)
    }
  }

  const onDecrement = async (task: NmProdTask) => {
    if (task.current_qty <= 0) return
    setBusyId(task.id)
    setError(null)
    markLocalListMutation()
    patchTaskLocal(task.id, (t) => ({
      ...t,
      current_qty: Math.max(t.current_qty - 1, 0),
      is_completed: false,
    }))
    try {
      await decrementTaskQty(task)
      scheduleRefreshReports()
    } catch (e: unknown) {
      setError(formatSupabaseOrError(e))
      await refreshCurrentTasks()
    } finally {
      setBusyId(null)
    }
  }

  const runToggleCompleted = async (task: NmProdTask) => {
    setBusyId(task.id)
    setError(null)
    markLocalListMutation()
    const nextCompleted = !task.is_completed
    patchTaskLocal(task.id, (t) => {
      if (nextCompleted) markTaskCompletedNow(t.id)
      return {
        ...t,
        is_completed: nextCompleted,
        current_qty: nextCompleted ? t.total_qty : t.current_qty,
      }
    })
    try {
      await toggleTaskCompleted(task)
      scheduleRefreshReports()
    } catch (e: unknown) {
      setError(formatSupabaseOrError(e))
      await refreshCurrentTasks()
    } finally {
      setBusyId(null)
    }
  }

  const onToggleCompleted = async (task: NmProdTask) => {
    if (!task.is_completed) {
      setPendingCutTask(task)
      return
    }
    await runToggleCompleted(task)
  }

  const confirmCutAll = async () => {
    if (!pendingCutTask) return
    const task = pendingCutTask
    setPendingCutTask(null)
    await runToggleCompleted(task)
  }

  const executeDeleteReport = async (id: string) => {
    setError(null)
    setLoading(true)
    try {
      await deleteReportCompletely(id)
      if (reportId === id) {
        setReportId(null)
        setTasks([])
      }
      await refreshReports()
    } catch (e: unknown) {
      setError(formatSupabaseOrError(e))
    } finally {
      setLoading(false)
    }
  }

  const confirmDeleteReport = async () => {
    if (!pendingDeleteReportId) return
    const id = pendingDeleteReportId
    setPendingDeleteReportId(null)
    await executeDeleteReport(id)
  }

  const confirmQuickAdd = async (payload: {
    dimensions: string
    materialType: MaterialTab
    from_faltas: boolean
    is_priority: boolean
    total_qty: number
  }) => {
    setError(null)
    setQuickAddError(null)

    setLoading(true)
    try {
      const task = {
        material_type: payload.materialType,
        dimensions: payload.dimensions.trim(),
        total_qty: Math.max(1, Math.floor(payload.total_qty) || 1),
        from_faltas: payload.from_faltas,
        is_priority: payload.is_priority,
      }

      const fechaDia = normalizeCalendarDate(selectedDate)
      let targetReportId: string | null = null
      if (reportsForSelectedDate.length > 0) {
        const enDia = reportId && reportsForSelectedDate.some((r) => r.id === reportId)
        targetReportId = enDia ? reportId : reportsForSelectedDate[0].id
      }

      if (targetReportId) {
        await mergeTaskIntoReport(targetReportId, task)
      } else {
        const { reportId: newId } = await createReportWithTasks({
          fecha: fechaDia,
          tasks: [task],
        })
        targetReportId = newId
      }

      setReportId(targetReportId)
      setPendingQuickAdd(false)
      setQuickAddError(null)
      await refreshReports()
      await refreshCurrentTasks()
    } catch (e: unknown) {
      setQuickAddError(formatSupabaseOrError(e))
    } finally {
      setLoading(false)
    }
  }

  if (authEnabled && !authReady) {
    return <HubLoadingScreen label="Iniciando…" />
  }

  if (authEnabled && authReady && isLogin && !session) {
    return <LoginPage />
  }

  if (authEnabled && authReady && session && isLogin) {
    return <HubEntrarRedirect role={profile?.role ?? null} />
  }

  if (authEnabled && authReady && !isLogin && !session) {
    return <HubLoadingScreen label="Redirigiendo…" />
  }

  if (authEnabled && authReady && session && isHubHome && !profileReady) {
    return <HubLoadingScreen label="Cargando perfil…" />
  }

  if (authEnabled && authReady && session && isHubHome) {
    return (
      <>
        {hubTaskPushListener(profile)}
        <HubHome user={user} profile={profile} profileError={profileError} />
      </>
    )
  }

  if (authEnabled && authReady && session && profileReady && profile) {
    if (!canAccessHubPath(path, profile.role)) {
      return (
        <HubRoleBlocked
          title="Sin acceso"
          message={hubPathBlockedMessage(path, profile.role)}
        />
      )
    }
  }

  if (authEnabled && authReady && session && isHubTasks && !profileReady) {
    return <HubLoadingScreen label="Cargando perfil…" />
  }

  if (authEnabled && authReady && session && isHubTasks && profileReady && !profile) {
    return <HubLoadingScreen label="No se pudo cargar el perfil del hub." />
  }

  if (authEnabled && authReady && session && isHubPrintedFiles && !profileReady) {
    return <HubLoadingScreen label="Cargando perfil…" />
  }

  if (
    authEnabled &&
    authReady &&
    session &&
    (isHubDispatchedCalendar ||
      isHubDispatchedCargar ||
      isHubDispatchedAnalytics ||
      isHubCutAnalytics) &&
    !profileReady
  ) {
    return <HubLoadingScreen label="Cargando perfil…" />
  }

  if (authEnabled && authReady && session && isHubTasks && profileReady && profile) {
    const hubReadOnly = hubTasksReadOnly(profile.role)
    return (
      <>
        {hubTaskPushListener(profile)}
        <HubTasksApp
          readOnly={hubReadOnly}
          profileRole={profile.role}
          profileId={profile.id}
          profileDisplayName={profile.display_name}
          isAdmin={profile.role === 'admin'}
          showSentTab={Boolean(getHubPermissions(profile.role)?.createHubTasks)}
        />
      </>
    )
  }

  if (
    authEnabled &&
    authReady &&
    session &&
    isHubPrintedFiles &&
    profileReady &&
    getHubPermissions(profile?.role)?.viewPrintedFiles
  ) {
    return (
      <HubPrintedFilesApp configured={configured} adminSignOut={profile?.role === 'admin'} />
    )
  }

  if (
    authEnabled &&
    authReady &&
    session &&
    (isHubDispatchedCalendar ||
      isHubDispatchedCargar ||
      isHubDispatchedAnalytics ||
      isHubCutAnalytics) &&
    profileReady &&
    !profile
  ) {
    return <HubLoadingScreen label="No se pudo cargar el perfil del hub." />
  }

  if (
    authEnabled &&
    authReady &&
    session &&
    isHubCutAnalytics &&
    profileReady &&
    profile &&
    profile.role === 'admin'
  ) {
    return (
      <HubAdminCutAnalytics configured={configured} role={profile.role} adminSignOut />
    )
  }

  if (
    authEnabled &&
    authReady &&
    session &&
    isHubDispatchedAnalytics &&
    profileReady &&
    profile &&
    profile.role === 'admin'
  ) {
    return (
      <HubAdminDispatchAnalytics
        configured={configured}
        role={profile.role}
        adminSignOut
      />
    )
  }

  if (
    authEnabled &&
    authReady &&
    session &&
    isHubDispatchedCargar &&
    profileReady &&
    profile &&
    getHubPermissions(profile.role)?.editDispatchedOrders
  ) {
    return (
      <HubDispatchedOrdersApp
        configured={configured}
        isAdmin={profile.role === 'admin'}
        adminSignOut={profile.role === 'admin'}
      />
    )
  }

  if (
    authEnabled &&
    authReady &&
    session &&
    isHubDispatchedCalendar &&
    profileReady &&
    profile &&
    getHubPermissions(profile.role)?.viewDispatchedOrders
  ) {
    return (
      <HubDispatchedStatsApp
        configured={configured}
        isAdmin={profile.role === 'admin'}
        adminSignOut={profile.role === 'admin'}
      />
    )
  }

  if (!authEnabled && isHubHome) {
    return <HubHome guestMode />
  }

  if (!authEnabled && isHubTasks) {
    return (
      <div className="nm-hub-app">
        <p className="nm-hub-muted">Configurá Supabase en <code>.env</code> para usar tareas.</p>
        <a
          href="/"
          className="nm-hub-back"
          style={{ display: 'inline-block', marginTop: '1rem' }}
          onClick={(e) => onHubLinkClick(e, '/')}
        >
          ← Inicio
        </a>
      </div>
    )
  }

  if (
    !authEnabled &&
    (isHubDispatchedCalendar || isHubDispatchedCargar || isHubDispatchedAnalytics || isHubCutAnalytics)
  ) {
    return (
      <div className="nm-hub-app">
        <p className="nm-hub-muted">
          Configurá Supabase en <code>.env</code> para ver pedidos despachados.
        </p>
        <a
          href="/"
          className="nm-hub-back"
          style={{ display: 'inline-block', marginTop: '1rem' }}
          onClick={(e) => onHubLinkClick(e, '/')}
        >
          ← Inicio
        </a>
      </div>
    )
  }

  if (!authEnabled && isHubPrintedFiles) {
    return (
      <div className="nm-hub-app">
        <p className="nm-hub-muted">Configurá Supabase en <code>.env</code> para ver archivos impresos.</p>
        <a
          href="/"
          className="nm-hub-back"
          style={{ display: 'inline-block', marginTop: '1rem' }}
          onClick={(e) => onHubLinkClick(e, '/')}
        >
          ← Inicio
        </a>
      </div>
    )
  }

  const isListaUpload = mode === 'creator'
  const isCutList = mode === 'manager'
  const hubShellClass = [
    isListaUpload
      ? 'nm-hub-app nm-hub-app--lista-upload'
      : isCutList
        ? 'nm-hub-app nm-hub-app--cut-list'
        : 'nm-prod-app',
    showOrdenarBar ? 'nm-hub-app--cut-list-ordenar' : '',
    showOrdenarBar ? 'nm-hub-app--cut-list-ordenar-expanded' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      {hubTaskPushListener(profile)}
      <div className={hubShellClass}>
      {!configured && (
        <div className="nm-prod-banner" role="status">
          Configura <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code>{' '}
          en un archivo <code>.env</code> (copia desde <code>.env.example</code>).
        </div>
      )}

      <header
        className={
          isListaUpload || isCutList
            ? 'nm-hub-header dashboard-navbar'
            : `nm-prod-header${mode === 'home' ? ' nm-prod-header--home' : ''}`
        }
      >
        <HubBrandBar
          integratedDashboard={isListaUpload || isCutList}
          adminSignOut={profile?.role === 'admin'}
          integratedSubtitle={
            isListaUpload ? 'Subir lista de corte' : isCutList ? 'Lista de corte' : undefined
          }
          integratedSubtitleTone={isListaUpload || isCutList ? 'default' : undefined}
          trailing={
            isCutList && canEditTasks ? (
              <button
                type="button"
                className="nm-hub-brand-bar__btn navbar-trailing-action-btn"
                onClick={() => {
                  setQuickAddError(null)
                  setPendingQuickAdd(true)
                }}
                disabled={!configured || loading}
                aria-label="Agregar medida al día seleccionado"
                title="Agregar medida"
              >
                +
              </button>
            ) : null
          }
        />
      </header>

      {mode === 'home' && !isHubHome && (
        <section className="nm-prod-section" aria-label="Navegación">
          <p className="nm-prod-task-meta" style={{ textAlign: 'center' }}>
            <a
              href="/"
              className="nm-prod-btn nm-prod-btn-primary"
              style={{ display: 'inline-flex', textDecoration: 'none' }}
              onClick={(e) => onHubLinkClick(e, '/')}
            >
              Ir al inicio
            </a>
          </p>
        </section>
      )}

      {canImportReports && (
        <section className="lista-upload-container" aria-labelledby="nm-prod-import-label">
          <label id="nm-prod-import-label" className="field-label-rebel" htmlFor="nm-prod-paste">
            Pegar reporte
          </label>
          <textarea
            id="nm-prod-paste"
            className="report-textarea-rebel"
            value={paste}
            onChange={(e) => {
              setPaste(e.target.value)
              if (success) setSuccess(null)
            }}
            placeholder="### REPORTE DE PRODUCCIÓN - 25/03/2026 ###&#10;--------------------------------&#10;LISTA CLASSIC&#10;--------------------------------&#10;90x40 - 15&#10;--------------------------------&#10;BORDES RECTOS&#10;--------------------------------&#10;90x40 Classic - 2&#10;--------------------------------&#10;LISTA FALTAS&#10;--------------------------------&#10;90x40 Classic - 2&#10;50x40 Pro - 1"
            spellCheck={false}
          />
          <button
            type="button"
            className="btn-primary-upload"
            disabled={!configured || loading || !paste.trim()}
            onClick={() => void onImport()}
          >
            {loading ? 'Guardando…' : 'Subir lista'}
          </button>
          {showCreadorMaterialImages ? (
            <button
              type="button"
              className="btn-secondary-media"
              disabled={!configured}
              onClick={() => {
                setMaterialImgModalOpen(true)
                if (success) setSuccess(null)
              }}
            >
              Subir imágenes
            </button>
          ) : null}
          {success ? (
            <p className="lista-upload-success" role="status">
              {success}
            </p>
          ) : null}
          {error && isListaUpload ? (
            <p className="nm-hub-error lista-upload-error" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      )}

      {mode === 'manager' && (
        <section className="cut-list-container cut-list-date-section" aria-labelledby="nm-prod-history-heading">
          <div className="nm-prod-date-nav cut-list-date-nav" role="group" aria-label="Cambiar día del historial">
            <div className="nm-prod-nav-arrow-wrap">
              <button
                type="button"
                className="nm-prod-btn"
                onClick={() => setSelectedDate((d) => addDays(d, -1))}
                disabled={!configured}
                aria-label="Día anterior"
              >
                {'<-'}
              </button>
              {hasPendingBeforeSelectedDate && (
                <span className="nm-prod-nav-pending-dot" aria-hidden="true">
                  !
                </span>
              )}
            </div>
            <strong className="nm-prod-date-label">{formatDayMonth(selectedDate)}</strong>
            <button
              type="button"
              className="nm-prod-btn"
              onClick={() => setSelectedDate((d) => addDays(d, 1))}
              disabled={!configured}
              aria-label="Día siguiente"
            >
              {'->'}
            </button>
          </div>

          {reportsForSelectedDate.length === 0 ? (
            <div className="nm-prod-all-cut-state">
              <p className="nm-prod-all-cut-text">
                No hay lista
              </p>
            </div>
          ) : null}
        </section>
      )}

      {error && isCutList ? (
        <p className="nm-hub-error cut-list-error" role="alert">
          {error}
        </p>
      ) : null}

      {error && !isListaUpload && !isCutList ? (
        <p className="nm-prod-error" role="alert">
          {error}
        </p>
      ) : null}

      {pendingCutTask && (
        <div className="nm-prod-modal-backdrop" role="presentation">
          <section className="nm-prod-modal" role="dialog" aria-modal="true">
            <h3 className="nm-prod-modal-title">Confirmar corte</h3>
            <p className="nm-prod-modal-text">
              Estas seguro de cortar todas las{' '}
              {Math.max(pendingCutTask.total_qty - pendingCutTask.current_qty, 0)} unidades?
            </p>
            <div className="nm-prod-row">
              <button
                type="button"
                className="nm-prod-btn"
                onClick={() => setPendingCutTask(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="nm-prod-btn nm-prod-btn-primary"
                onClick={() => void confirmCutAll()}
              >
                Cortar
              </button>
            </div>
          </section>
        </div>
      )}

      {pendingDeleteReportId && (
        <div className="nm-prod-modal-backdrop" role="presentation">
          <section className="nm-prod-modal" role="dialog" aria-modal="true">
            <h3 className="nm-prod-modal-title">Confirmar eliminación</h3>
            <p className="nm-prod-modal-text">
              ¿Estás seguro? Se eliminará la lista completa y sus tareas. Esta acción no se puede deshacer.
            </p>
            <div className="nm-prod-row">
              <button
                type="button"
                className="nm-prod-btn"
                onClick={() => setPendingDeleteReportId(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="nm-prod-btn nm-prod-btn-primary"
                disabled={loading}
                onClick={() => void confirmDeleteReport()}
              >
                Eliminar
              </button>
            </div>
          </section>
        </div>
      )}

      {showCreadorMaterialImages ? (
        <CreadorMaterialImagesModal
          open={materialImgModalOpen}
          configured={configured}
          onClose={() => setMaterialImgModalOpen(false)}
          onDone={(msg) => setSuccess(msg)}
        />
      ) : null}

      <QuickAddMeasureModal
        open={pendingQuickAdd}
        dayLabel={formatDayMonth(selectedDate)}
        loading={loading}
        error={quickAddError}
        onClose={() => {
          if (loading) return
          setPendingQuickAdd(false)
          setQuickAddError(null)
        }}
        onConfirm={(payload) => void confirmQuickAdd(payload)}
      />

      {mode === 'manager' && reportId && (
        <section className="cut-list-container" aria-labelledby="nm-prod-tasks-heading">
          <div className="cut-list-filter-wrap">
            <label className="nm-hub-sr-only" htmlFor="nm-prod-task-filter">
              Filtrar tareas
            </label>
            <select
              id="nm-prod-task-filter"
              className="select-filter-rebel"
              value={taskFilter}
              onChange={(e) => {
                const next = e.target.value
                if (next === 'all') {
                  setTaskFilter('all')
                  return
                }
                setTaskFilter(next as Exclude<TaskFilter, 'all'>)
              }}
            >
              <option value="all">Todas</option>
              <option value="priority">Prioridad</option>
              <option value="standard">Standar</option>
              <option value="completed">Cortados</option>
            </select>
          </div>
          <div className="cut-list-tabs-toolbar">
            <MaterialTabs
              available={materialsAvailable.length ? materialsAvailable : TAB_ORDER}
              active={activeTab}
              counts={counts}
              onChange={setActiveTab}
              variant="rebel"
            />
          </div>
          {taskFilter === 'completed' && (
            <div className="cut-list-search-row">
              <label className="nm-prod-completed-search-inline cut-list-search">
                <span className="nm-prod-completed-search-inline-icon" aria-hidden="true">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                    <path
                      d="M20 20 16.65 16.65"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <input
                  type="text"
                  inputMode="search"
                  className="nm-prod-completed-search-inline-input"
                  value={completedSearch}
                  onChange={(e) => setCompletedSearch(e.target.value)}
                  placeholder="Medida o notas…"
                  aria-label="Filtrar por medida o notas en cortados"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </label>
            </div>
          )}
          <div className="cut-list-items">
            {stripPackSortActive ? (
              mergeAllListsActive && allPendingTasksLoading ? (
                <p className="nm-prod-task-meta">Calculando plan de corte…</p>
              ) : (
                <>
                  {sortedMoldTasks.length > 0 ? (
                    <section className="cut-mold-section" aria-label="Planchar">
                      <p className="cut-mold-section__title">Planchar</p>
                      <MaterialMetersLine cm={moldRollLengthCm} />
                      {mergedMoldGroups
                        ? mergedMoldGroups.map((group) => (
                            <TaskCard
                              key={group.measureKey}
                              task={group.displayTask}
                              busy={group.sources.some((t) => busyId === t.id)}
                              canEdit={canEditTasks}
                              onIncrement={() => {
                                const next = firstPendingMoldSource(group.sources)
                                if (next) void onIncrement(next)
                              }}
                              onDecrement={() => {
                                const prev = lastCutMoldSource(group.sources)
                                if (prev) void onDecrement(prev)
                              }}
                              onTogglePriority={() => {
                                const target =
                                  group.sources.find((t) => t.is_priority) ?? group.sources[0]
                                void onTogglePriority(target)
                              }}
                              onToggleCompleted={() => {
                                const target = firstPendingMoldSource(group.sources) ?? group.sources[0]
                                void runToggleCompleted(target)
                              }}
                              showOnlyDecrement={taskFilter === 'completed'}
                              variant="rebel"
                              ordenarPlanchaHint={moldPlanchaHints.get(group.measureKey)}
                            />
                          ))
                        : sortedMoldTasks.map((t) => (
                            <TaskCard
                              key={t.id}
                              task={t}
                              busy={busyId === t.id}
                              canEdit={canEditTasks}
                              onIncrement={onIncrement}
                              onDecrement={onDecrement}
                              onTogglePriority={onTogglePriority}
                              onToggleCompleted={onToggleCompleted}
                              showOnlyDecrement={taskFilter === 'completed'}
                              variant="rebel"
                              ordenarPlanchaHint={moldPlanchaHints.get(t.id)}
                            />
                          ))}
                    </section>
                  ) : null}
                  {operatorCutPlan ? (
                    <section className="cut-plan-section" aria-label="Personalizados">
                      {sortedMoldTasks.length > 0 ? (
                        <p className="cut-plan-section__title">Personalizados</p>
                      ) : null}
                      <CutStripPlanView plan={operatorCutPlan} materialMetersCm={planRollLengthCm} />
                    </section>
                  ) : sortedMoldTasks.length === 0 ? (
                    <div className="nm-prod-all-cut-state">
                      <p className="nm-prod-empty-text">No hay medidas pendientes para ordenar.</p>
                    </div>
                  ) : null}
                </>
              )
            ) : mergeAllListsActive && allPendingTasksLoading ? (
              <p className="nm-prod-task-meta">Cargando todas las listas…</p>
            ) : !tasksLoaded && tasks.length === 0 ? (
              <p className="nm-prod-task-meta">Cargando tareas…</p>
            ) : tasks.length === 0 && !mergeAllListsActive ? (
              <p className="nm-prod-task-meta">Este reporte no tiene tareas.</p>
            ) : visibleTasks.length === 0 ? (
                  mergeAllListsActive ? (
                    <div className="nm-prod-all-cut-state">
                      <p className="nm-prod-empty-text">
                        No hay pendientes en esta pestaña en ningún día.
                      </p>
                    </div>
                  ) : allCutEntireReport ? (
                    <div className="nm-prod-all-cut-state">
                      <p className="nm-prod-all-cut-text">Todo cortado! Seguí así</p>
                    </div>
                  ) : allCutInActiveTab && hasPendingInOtherMaterialTab ? (
                    <div className="nm-prod-all-cut-state">
                      <p className="nm-prod-empty-text">
                        En esta pestaña no hay pendientes. Revisá las otras pestañas de material.
                      </p>
                    </div>
                  ) : (
                    <div className="nm-prod-all-cut-state">
                      <p className="nm-prod-empty-text">No hay items</p>
                    </div>
                  )
                ) : (
                  visibleTasks.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      busy={busyId === t.id}
                      canEdit={canEditTasks}
                      onIncrement={onIncrement}
                      onDecrement={onDecrement}
                      onTogglePriority={onTogglePriority}
                      onToggleCompleted={onToggleCompleted}
                      showOnlyDecrement={taskFilter === 'completed'}
                      variant="rebel"
                      listDayLabel={
                        mergeAllListsActive
                          ? formatDayMonth(reportFechaById.get(t.report_id) ?? '')
                          : undefined
                      }
                    />
                  ))
            )}
          </div>
          {canDeleteReports && taskFilter === 'completed' && reportId && (
            <div className="nm-prod-delete-list-wrap">
              <button
                type="button"
                className="nm-prod-btn nm-prod-btn-danger"
                disabled={loading}
                onClick={() => setPendingDeleteReportId(reportId)}
              >
                Eliminar lista seleccionada
              </button>
            </div>
          )}
        </section>
      )}

      {showOrdenarBar ? (
        <div
          className="cut-list-ordenar-bar cut-list-ordenar-bar--expanded"
          role="toolbar"
          aria-label="Ordenar lista de corte"
        >
          <button
            type="button"
            className={`cut-list-ordenar-btn filter-pill${stripPackSortActive ? ' active' : ''}`}
            aria-pressed={stripPackSortActive}
            onClick={() => setStripPackSortActive((prev) => !prev)}
          >
            {stripPackSortActive ? 'Ver lista' : 'Ordenar'}
          </button>
          <label className="cut-list-ordenar-merge">
            <input
              type="checkbox"
              className="cut-list-ordenar-merge-input"
              checked={mergeAllListsChecked}
              disabled={allPendingTasksLoading}
              onChange={(e) => setMergeAllListsChecked(e.target.checked)}
            />
            <span>Sumar TODAS las listas</span>
          </label>
        </div>
      ) : null}
    </div>
    </>
  )
}
