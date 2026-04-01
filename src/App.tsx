import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MaterialTabs } from './components/MaterialTabs'
import { TaskCard } from './components/TaskCard'
import { normalizeCalendarDate, todayIsoLocal } from './lib/date'
import { parseProductionReport } from './lib/parseReport'
import { sortTasksForDisplay } from './lib/sortTasks'
import { surfaceFromDimensions } from './lib/surface'
import {
  createReportWithTasks,
  mergeTaskIntoReport,
  decrementTaskQty,
  deleteReportCompletely,
  fetchReportsWithTasksProgress,
  fetchTasks,
  incrementTaskQty,
  restoreTaskQty,
  supabase,
  toggleTaskCompleted,
  toggleTaskPriority,
} from './lib/supabase'
import type { MaterialTab, NmProdReport, NmProdTask } from './lib/types'

const TAB_ORDER: MaterialTab[] = ['classic', 'pro', 'alfombras']

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

function parseQuickTaskInput(raw: string): { dimensions: string, materialType: MaterialTab } | null {
  const m = raw.trim().match(/^(\d+)\s*[xX×]\s*(\d+)\s+(.+)$/)
  if (!m) return null
  const width = Number(m[1])
  const height = Number(m[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  const materialRaw = m[3].trim().toLowerCase()
  let materialType: MaterialTab | null = null
  if (materialRaw.includes('classic')) materialType = 'classic'
  else if (/\bpro\b/.test(materialRaw)) materialType = 'pro'
  else if (materialRaw.includes('alfombra')) materialType = 'alfombras'
  else if (materialRaw.includes('otro')) materialType = 'otros'
  if (!materialType) return null

  return {
    dimensions: `${width}x${height}`,
    materialType,
  }
}

type TaskFilter = 'all' | 'priority' | 'standard' | 'completed'
type SizeSortMode = 'default' | 'desc' | 'asc'
const STANDARD_DIMENSIONS = new Set(['90x40', '82x32', '50x40'])
function matchesTaskFilter(task: NmProdTask, filter: TaskFilter): boolean {
  const done = task.is_completed || task.current_qty >= task.total_qty
  if (filter === 'completed') return done
  if (filter === 'priority') return task.is_priority && !done
  if (filter === 'standard') return STANDARD_DIMENSIONS.has(task.dimensions.trim()) && !done
  return !done
}

function areaFromDimensions(dimensions: string): number {
  const match = dimensions.match(/(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)/i)
  if (!match) return 0
  const width = Number(match[1].replace(',', '.'))
  const height = Number(match[2].replace(',', '.'))
  if (Number.isNaN(width) || Number.isNaN(height)) return 0
  return width * height
}

export default function App() {
  const configured = Boolean(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
  )

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
  const pathname = window.location.pathname.toLowerCase()
  const mode: 'home' | 'creator' | 'manager' =
    pathname === '/creador' ? 'creator' : pathname === '/manejador' ? 'manager' : 'home'
  const canEditTasks = mode === 'manager'
  const canImportReports = mode === 'creator'
  const canDeleteReports = mode === 'manager'
  const [selectedDate, setSelectedDate] = useState(todayIsoLocal)
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all')
  const [completedSearch, setCompletedSearch] = useState('')
  const [sizeSortMode, setSizeSortMode] = useState<SizeSortMode>('default')
  const [completionFlashIds, setCompletionFlashIds] = useState<Set<string>>(new Set())
  const [completedAtById, setCompletedAtById] = useState<Record<string, number>>({})
  const [pendingCutTask, setPendingCutTask] = useState<NmProdTask | null>(null)
  const [pendingDeleteReportId, setPendingDeleteReportId] = useState<string | null>(null)
  const [pendingQuickAdd, setPendingQuickAdd] = useState(false)
  const [quickAddInput, setQuickAddInput] = useState('')
  const [quickAddError, setQuickAddError] = useState<string | null>(null)
  const [pendingDates, setPendingDates] = useState<Set<string>>(new Set())

  /** Solo aplica el último refresh en vuelo; si uno viejo termina después, no pisa reports/pendingDates (el "!" quedaba pegado). */
  const reportsRefreshSeqRef = useRef(0)

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
      void refreshReports().catch(() => {})
    }, 350)
  }, [refreshReports])

  const refreshCurrentTasks = useCallback(async () => {
    if (!configured || !reportId) return
    const rows = await fetchTasks(reportId)
    setTasks(rows)
  }, [configured, reportId])

  const patchTaskLocal = useCallback((taskId: string, updater: (t: NmProdTask) => NmProdTask) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? updater(t) : t)))
  }, [])

  const flashCompletedTask = useCallback((taskId: string) => {
    setCompletionFlashIds((prev) => {
      const next = new Set(prev)
      next.add(taskId)
      return next
    })
    window.setTimeout(() => {
      setCompletionFlashIds((prev) => {
        const next = new Set(prev)
        next.delete(taskId)
        return next
      })
    }, 180)
  }, [])

  const markTaskCompletedNow = useCallback((taskId: string) => {
    setCompletedAtById((prev) => ({ ...prev, [taskId]: Date.now() }))
  }, [])

  useEffect(() => {
    refreshReports().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e))
    })
  }, [refreshReports])

  useEffect(() => {
    if (!configured || mode !== 'manager') return
    void refreshReports().catch(() => {})
  }, [selectedDate, configured, mode, refreshReports])

  useEffect(() => {
    if (!configured || !reportId || !supabase) {
      setTasks([])
      setTasksLoaded(false)
      return
    }

    let cancelled = false
    setTasksLoaded(false)

    const loadTasks = () =>
      fetchTasks(reportId).then((rows) => {
        if (!cancelled) {
          setTasks(rows)
          setTasksLoaded(true)
        }
      })

    loadTasks().catch((e: unknown) => {
      if (!cancelled) {
        setError(e instanceof Error ? e.message : String(e))
        setTasksLoaded(true)
      }
    })

    const channel = supabase
      .channel(`nm_prod_tasks:${reportId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'nm_prod_tasks',
          filter: `report_id=eq.${reportId}`,
        },
        () => {
          loadTasks()
            .then(() => {
              scheduleRefreshReports()
            })
            .catch(() => {})
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      if (pendingReportsRefreshRef.current !== null) {
        window.clearTimeout(pendingReportsRefreshRef.current)
        pendingReportsRefreshRef.current = null
      }
      if (supabase) void supabase.removeChannel(channel)
    }
  }, [configured, reportId, scheduleRefreshReports])

  const tasksByMainFilter = useMemo(
    () =>
      tasks.filter((t) => {
        if (matchesTaskFilter(t, taskFilter)) return true
        return taskFilter !== 'completed' && completionFlashIds.has(t.id)
      }),
    [tasks, taskFilter, completionFlashIds],
  )

  const materialsAvailable = useMemo(() => {
    const present = new Set<MaterialTab>()
    for (const t of tasksByMainFilter) present.add(tabForMaterialType(t.material_type))
    return TAB_ORDER.filter((m) => present.has(m))
  }, [tasksByMainFilter])

  useEffect(() => {
    if (materialsAvailable.length === 0) return
    if (!materialsAvailable.includes(activeTab)) {
      setActiveTab(materialsAvailable[0])
    }
  }, [materialsAvailable, activeTab])

  const counts = useMemo(() => {
    const c: Record<MaterialTab, number> = {
      classic: 0,
      pro: 0,
      alfombras: 0,
      otros: 0,
    }
    for (const t of tasksByMainFilter) {
      c[tabForMaterialType(t.material_type)] += 1
    }
    return c
  }, [tasksByMainFilter])

  const visibleTasks = useMemo(() => {
    const tabbed = tasksByMainFilter.filter(
      (t) => tabForMaterialType(t.material_type) === activeTab,
    )
    const q = completedSearch.trim().toLowerCase()
    const searched =
      taskFilter === 'completed'
        ? tabbed.filter((t) => (q ? t.dimensions.toLowerCase().includes(q) : true))
        : tabbed

    const base = (() => {
      if (taskFilter !== 'completed') {
        return sortTasksForDisplay(searched)
      }
      return [...searched].sort((a, b) => {
        const da = a.dimensions.toLowerCase()
        const db = b.dimensions.toLowerCase()
        if (q) {
          const rank = (d: string) => (d === q ? 0 : d.startsWith(q) ? 1 : 2)
          const ra = rank(da)
          const rb = rank(db)
          if (ra !== rb) return ra - rb
        }
        const timeA = completedAtById[a.id] ?? Date.parse(a.created_at)
        const timeB = completedAtById[b.id] ?? Date.parse(b.created_at)
        const byRecentCut = (Number.isFinite(timeB) ? timeB : 0) - (Number.isFinite(timeA) ? timeA : 0)
        if (byRecentCut !== 0) return byRecentCut
        return surfaceFromDimensions(b.dimensions) - surfaceFromDimensions(a.dimensions)
      })
    })()

    if (sizeSortMode === 'default') return base

    const withIndex = base.map((task, index) => ({ task, index }))
    withIndex.sort((a, b) => {
      const areaA = areaFromDimensions(a.task.dimensions)
      const areaB = areaFromDimensions(b.task.dimensions)
      if (areaA === areaB) return a.index - b.index
      return sizeSortMode === 'asc' ? areaA - areaB : areaB - areaA
    })
    return withIndex.map((entry) => entry.task)
  }, [tasksByMainFilter, activeTab, sizeSortMode, taskFilter, completedSearch, completedAtById])

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

  const reportsForSelectedDate = useMemo(() => {
    const sel = normalizeCalendarDate(selectedDate)
    return reports.filter((r) => normalizeCalendarDate(r.fecha) === sel)
  }, [reports, selectedDate])

  const hasPendingBeforeSelectedDate = useMemo(() => {
    const sel = normalizeCalendarDate(selectedDate)
    for (const d of pendingDates) {
      if (normalizeCalendarDate(d) < sel) return true
    }
    return false
  }, [pendingDates, selectedDate])

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
    if (reportId && reportsForSelectedDate.some((r) => r.id === reportId)) return
    setReportId(reportsForSelectedDate[0].id)
  }, [mode, reportsForSelectedDate, reportId])

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
      })),
    )
    if (flat.length === 0) {
      setError('No se detectaron ítems. Revisa separadores y líneas tipo 90x40 - 15.')
      return
    }
    setLoading(true)
    try {
      await createReportWithTasks({ fecha, tasks: flat })
      setPaste('')
      setSuccess('Lista subida correctamente')
      await refreshReports()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const onIncrement = async (task: NmProdTask) => {
    setBusyId(task.id)
    setError(null)
    patchTaskLocal(task.id, (t) => ({
      ...t,
      current_qty: Math.min(t.current_qty + 1, t.total_qty),
      is_completed: t.current_qty + 1 >= t.total_qty ? true : t.is_completed,
    }))
    if (task.current_qty + 1 >= task.total_qty) {
      flashCompletedTask(task.id)
      markTaskCompletedNow(task.id)
    }
    try {
      await incrementTaskQty(task)
      await refreshReports()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      await refreshCurrentTasks()
    } finally {
      setBusyId(null)
    }
  }

  const onTogglePriority = async (task: NmProdTask) => {
    setBusyId(task.id)
    setError(null)
    patchTaskLocal(task.id, (t) => ({ ...t, is_priority: !t.is_priority }))
    try {
      await toggleTaskPriority(task)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      await refreshCurrentTasks()
    } finally {
      setBusyId(null)
    }
  }

  const onDecrement = async (task: NmProdTask) => {
    setBusyId(task.id)
    setError(null)
    const done = task.is_completed || task.current_qty >= task.total_qty
    patchTaskLocal(task.id, (t) =>
      done
        ? {
            ...t,
            current_qty: 0,
            is_completed: false,
          }
        : {
            ...t,
            current_qty: Math.max(t.current_qty - 1, 0),
            is_completed: false,
          },
    )
    try {
      if (done) await restoreTaskQty(task)
      else await decrementTaskQty(task)
      await refreshReports()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      await refreshCurrentTasks()
    } finally {
      setBusyId(null)
    }
  }

  const runToggleCompleted = async (task: NmProdTask) => {
    setBusyId(task.id)
    setError(null)
    const nextCompleted = !task.is_completed
    patchTaskLocal(task.id, (t) => {
      if (nextCompleted) {
        flashCompletedTask(t.id)
        markTaskCompletedNow(t.id)
      }
      return {
        ...t,
        is_completed: nextCompleted,
        current_qty: nextCompleted ? t.total_qty : t.current_qty,
      }
    })
    try {
      await toggleTaskCompleted(task)
      await refreshReports()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
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

  const cycleSizeSortMode = () => {
    setSizeSortMode((prev) => {
      if (prev === 'default') return 'desc'
      if (prev === 'desc') return 'asc'
      return 'default'
    })
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
      setError(e instanceof Error ? e.message : String(e))
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

  const confirmQuickAdd = async () => {
    setError(null)
    setQuickAddError(null)
    const parsed = parseQuickTaskInput(quickAddInput)
    if (!parsed) {
      setQuickAddError('Formato: 90x40 Classic, 56x40 pro, etc.')
      return
    }

    setLoading(true)
    try {
      const task = {
        material_type: parsed.materialType,
        dimensions: parsed.dimensions.trim(),
        total_qty: 1,
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
      setQuickAddInput('')
      await refreshReports()
      await refreshCurrentTasks()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="nm-prod-app">
      {!configured && (
        <div className="nm-prod-banner" role="status">
          Configura <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code>{' '}
          en un archivo <code>.env</code> (copia desde <code>.env.example</code>).
        </div>
      )}

      <header className={`nm-prod-header${mode === 'home' ? ' nm-prod-header--home' : ''}`}>
        <div className="nm-prod-nav-minimal">
          <h1 className="nm-prod-title">NOTMID</h1>
          {mode !== 'home' && (
            <div className="nm-prod-header-actions">
              {mode === 'manager' && (
                <button
                  type="button"
                  className="nm-prod-btn nm-prod-btn-icon"
                  onClick={() => {
                    setQuickAddInput('')
                    setQuickAddError(null)
                    setPendingQuickAdd(true)
                  }}
                  disabled={!configured || loading}
                  aria-label="Agregar medida al día seleccionado"
                  title="Agregar medida"
                >
                  +
                </button>
              )}
              <a href="/" className="nm-prod-btn nm-prod-btn-icon nm-prod-btn-home" aria-label="Inicio" title="Inicio">
                <svg
                  className="nm-prod-icon-home"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M4 10.5 12 4l8 6.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M7.5 10v10h9V10"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M10.5 20v-4h3v4"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
            </div>
          )}
        </div>
      </header>

      {mode === 'home' && (
        <div className="nm-prod-home-hub">
          <section className="nm-prod-home-hub-inner" aria-label="Acciones principales">
            <div className="nm-prod-home-hub-actions">
              <a href="/creador" className="nm-prod-btn nm-prod-btn-primary nm-prod-home-hub-btn">
                Subir lista
              </a>
              <a href="/manejador" className="nm-prod-btn nm-prod-btn-list-view nm-prod-home-hub-btn">
                Ver lista
              </a>
            </div>
          </section>
        </div>
      )}

      {canImportReports && (
        <section className="nm-prod-section" aria-labelledby="nm-prod-import-heading">
          <h2 id="nm-prod-import-heading" className="nm-prod-label">
            Pegar reporte
          </h2>
          <textarea
            className="nm-prod-textarea"
            value={paste}
            onChange={(e) => {
              setPaste(e.target.value)
              if (success) setSuccess(null)
            }}
            placeholder="### REPORTE DE PRODUCCIÓN - 25/03/2026 ###&#10;--------------------------------&#10;LISTA CLASSIC&#10;--------------------------------&#10;90x40 - 15"
            spellCheck={false}
          />
          <button
            type="button"
            className="nm-prod-btn nm-prod-btn-primary"
            style={{ width: '100%', marginTop: '0.75rem' }}
            disabled={!configured || loading || !paste.trim()}
            onClick={() => void onImport()}
          >
            {loading ? 'Guardando…' : 'Subir lista'}
          </button>
          {success && (
            <p className="nm-prod-success" role="status">
              {success}
            </p>
          )}
        </section>
      )}

      {mode === 'manager' && (
        <section className="nm-prod-section" aria-labelledby="nm-prod-history-heading">
          <div className="nm-prod-date-nav" role="group" aria-label="Cambiar día del historial">
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

      {error && (
        <p className="nm-prod-error" role="alert">
          {error}
        </p>
      )}

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

      {pendingQuickAdd && (
        <div className="nm-prod-modal-backdrop" role="presentation">
          <section className="nm-prod-modal" role="dialog" aria-modal="true">
            <h3 className="nm-prod-modal-title">Agregar medida al día {formatDayMonth(selectedDate)}</h3>
            <p className="nm-prod-modal-text">Ejemplo: 90x40 Classic o 56x40 pro</p>
            <input
              type="text"
              className="nm-prod-modal-input"
              value={quickAddInput}
              onChange={(e) => {
                setQuickAddInput(e.target.value)
                if (quickAddError) setQuickAddError(null)
              }}
              placeholder="90x40 Classic"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            {quickAddError && (
              <p className="nm-prod-error" role="alert">
                {quickAddError}
              </p>
            )}
            <div className="nm-prod-row">
              <button
                type="button"
                className="nm-prod-btn"
                onClick={() => setPendingQuickAdd(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="nm-prod-btn nm-prod-btn-primary"
                disabled={loading || !quickAddInput.trim()}
                onClick={() => void confirmQuickAdd()}
              >
                {loading ? 'Guardando…' : 'Agregar'}
              </button>
            </div>
          </section>
        </div>
      )}

      {mode === 'manager' && reportId && (
        <section className="nm-prod-section" aria-labelledby="nm-prod-tasks-heading">
          {!tasksLoaded ? (
            <p className="nm-prod-task-meta">Cargando tareas…</p>
          ) : tasks.length === 0 ? (
            <p className="nm-prod-task-meta">Este reporte no tiene tareas.</p>
          ) : (
            <>
              {mode === 'manager' && (
                <div className="nm-prod-row">
                  <select
                    id="nm-prod-task-filter"
                    className="nm-prod-select nm-prod-select-filter"
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
              )}
              <div className="nm-prod-tabs-wrap">
                <div className="nm-prod-tabs-row">
                  <MaterialTabs
                    available={
                      materialsAvailable.length ? materialsAvailable : TAB_ORDER
                    }
                    active={activeTab}
                    counts={counts}
                    onChange={setActiveTab}
                  />
                  {taskFilter === 'all' && (
                    <button
                      type="button"
                      className="nm-prod-btn nm-prod-btn-icon nm-prod-sort-btn"
                      onClick={cycleSizeSortMode}
                      aria-label="Cambiar orden de medidas"
                      title={
                        sizeSortMode === 'default'
                          ? 'Orden actual'
                          : sizeSortMode === 'desc'
                            ? 'Mayor a menor'
                            : 'Menor a mayor'
                      }
                    >
                      {sizeSortMode === 'default' ? '-' : sizeSortMode === 'desc' ? '↑' : '↓'}
                    </button>
                  )}
                  {taskFilter === 'completed' && (
                    <label className="nm-prod-completed-search-inline nm-prod-sort-btn">
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
                        placeholder="Medida…"
                        aria-label="Filtrar medidas en cortados"
                        autoCapitalize="none"
                        autoCorrect="off"
                      />
                    </label>
                  )}
                </div>
              </div>
              <div className="nm-prod-task-list">
                {visibleTasks.length === 0 ? (
                  allCutEntireReport ? (
                    <div className="nm-prod-all-cut-state">
                      <p className="nm-prod-all-cut-text">Todo cortado! Seguí así</p>
                    </div>
                  ) : allCutInActiveTab && hasPendingInOtherMaterialTab ? (
                    <div className="nm-prod-all-cut-state">
                      <p className="nm-prod-empty-text">
                        En esta pestaña no hay pendientes. Revisá Classic / Pro / Alfombras.
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
            </>
          )}
        </section>
      )}
    </div>
  )
}
