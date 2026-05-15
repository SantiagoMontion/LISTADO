import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  appendTaskImages,
  createHubTask,
  fetchHasPendingHubTasksBefore,
  fetchHubProfileDisplayNames,
  fetchHubTasksCompleted,
  fetchHubTasksPending,
  signedImageUrl,
  updateHubTaskExecuted,
} from '../lib/hubTasksApi'
import { formatSupabaseOrError } from '../lib/errors'
import { addDaysToIsoDate, formatDayMonthShort, normalizeCalendarDate, todayIsoLocal } from '../lib/date'
import type { HubImportance, NmHubTask } from '../lib/types'
import { HubBrandBar } from './HubBrandBar'
import { HUB_NAV_EVENT } from '../lib/hubNavigate'

const IMPORTANCE_LABEL: Record<HubImportance, string> = {
  low: 'Baja',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
}

type TasksPanel = 'list' | 'create'
type HubListMode = 'pendientes' | 'completadas'

function readHubListMode(): HubListMode {
  if (typeof window === 'undefined') return 'pendientes'
  const hub = new URLSearchParams(window.location.search).get('hub')
  return hub === 'completadas' ? 'completadas' : 'pendientes'
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

function setListModeInUrl(mode: HubListMode) {
  if (typeof window === 'undefined') return
  const u = new URL(window.location.href)
  if (mode === 'completadas') {
    u.searchParams.set('hub', 'completadas')
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

function TaskThumbnails({ paths }: { paths: string[] }) {
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
  return (
    <>
      <div className="nm-hub-task-images">
        {paths.map((p) =>
          urls[p] ? (
            <button
              key={p}
              type="button"
              className="nm-hub-thumb-btn"
              onClick={() => setLightbox(urls[p])}
              aria-label="Ampliar imagen"
            >
              <img src={urls[p]} alt="" className="nm-hub-thumb" />
            </button>
          ) : (
            <span key={p} className="nm-hub-thumb-placeholder" />
          ),
        )}
      </div>
      {lightbox ? <HubImageLightbox src={lightbox} onClose={() => setLightbox(null)} /> : null}
    </>
  )
}

export function HubTasksApp({ readOnly = false }: { readOnly?: boolean }) {
  const [tasks, setTasks] = useState<NmHubTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [listMode, setListMode] = useState<HubListMode>(() => (typeof window !== 'undefined' ? readHubListMode() : 'pendientes'))
  const [hasOlderPending, setHasOlderPending] = useState(false)
  const [executorNames, setExecutorNames] = useState<Record<string, string>>({})
  const [taskQuery, setTaskQuery] = useState('')

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
  const [files, setFiles] = useState<File[]>([])

  const load = useCallback(async () => {
    setError(null)
    const mode = readHubListMode()
    setListMode(mode)
    const rows =
      mode === 'completadas' ? await fetchHubTasksCompleted(taskDay) : await fetchHubTasksPending(taskDay)
    setTasks(rows)
    if (mode === 'completadas') {
      const ids = rows.map((t) => t.executed_by).filter((x): x is string => Boolean(x))
      const names = await fetchHubProfileDisplayNames(ids)
      setExecutorNames(names)
    } else {
      setExecutorNames({})
    }
  }, [taskDay, hubDataGen])

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
    let cancelled = false
    fetchHasPendingHubTasksBefore(taskDay)
      .then((v) => {
        if (!cancelled) setHasOlderPending(v)
      })
      .catch(() => {
        if (!cancelled) setHasOlderPending(false)
      })
    return () => {
      cancelled = true
    }
  }, [taskDay, tasks])

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
    setListMode(readHubListMode())
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

  const sorted = useMemo(
    () => (listMode === 'completadas' ? sortCompletedTasks(tasks) : sortPendingTasks(tasks)),
    [tasks, listMode],
  )

  const filteredSorted = useMemo(() => {
    const q = taskQuery.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((t) => {
      const title = (t.title ?? '').toLowerCase()
      const body = (t.body ?? '').toLowerCase()
      return title.includes(q) || body.includes(q)
    })
  }, [sorted, taskQuery])

  useEffect(() => {
    setTaskQuery('')
  }, [taskDay, listMode])

  const goCreatePanel = useCallback(() => {
    if (readOnly) return
    replaceCreatePanelUrl()
    setPanel('create')
  }, [readOnly])

  const goListPanel = useCallback(() => {
    replaceListPanelUrl()
    setPanel('list')
  }, [])

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (readOnly || !title.trim()) return
    setBusy(true)
    setError(null)
    try {
      const created = await createHubTask({
        title: title.trim(),
        body: body.trim() || null,
        importance,
        for_date: taskDay,
      })
      if (files.length > 0) {
        await appendTaskImages(created.id, files)
      }
      setTitle('')
      setBody('')
      setImportance('normal')
      setFiles([])
      await load()
      replaceListPanelUrl()
      setPanel('list')
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
    try {
      await updateHubTaskExecuted(t.id, executed)
      await load()
    } catch (err: unknown) {
      setError(formatSupabaseOrError(err))
    } finally {
      setBusy(false)
    }
  }

  const brandContext =
    panel === 'create' ? 'Nueva' : listMode === 'completadas' ? 'Completadas' : 'Pendientes'

  const showCreateBtn = !readOnly && (panel === 'create' || panel === 'list')

  return (
    <div className="nm-hub-app">
      <header className="nm-hub-header">
        <HubBrandBar
          context={brandContext}
          trailing={
            showCreateBtn ? (
              panel === 'list' ? (
                <button
                  type="button"
                  className="nm-hub-brand-bar__btn"
                  onClick={() => goCreatePanel()}
                  aria-label="Nueva tarea"
                  title="Nueva tarea"
                >
                  +
                </button>
              ) : (
                <button
                  type="button"
                  className="nm-hub-brand-bar__btn"
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

      <section className="nm-hub-date-strip" aria-label="Día de las tareas">
        <div className="nm-hub-date-nav">
          <div className="nm-hub-date-nav-prev-wrap">
            <button
              type="button"
              className="nm-hub-btn nm-hub-btn-ghost"
              onClick={() => applyTaskDay(addDaysToIsoDate(taskDay, -1))}
              aria-label="Día anterior"
            >
              ←
            </button>
            {hasOlderPending ? (
              <span className="nm-hub-nav-pending-dot" title="Hay tareas pendientes en días anteriores" aria-hidden="true">
                !
              </span>
            ) : null}
          </div>
          <div className="nm-hub-date-picker">
            <span className="nm-hub-date-display">{formatDayMonthShort(taskDay)}</span>
            <input
              type="date"
              className="nm-hub-input nm-hub-date-native"
              value={taskDay}
              onChange={(e) => applyTaskDay(normalizeCalendarDate(e.target.value))}
              aria-label="Elegir día"
            />
          </div>
          <button
            type="button"
            className="nm-hub-btn nm-hub-btn-ghost"
            onClick={() => applyTaskDay(addDaysToIsoDate(taskDay, 1))}
            aria-label="Día siguiente"
          >
            →
          </button>
        </div>
      </section>

      {panel === 'list' ? (
        <div className="nm-hub-task-search-wrap">
          <label className="nm-hub-sr-only" htmlFor="nm-hub-task-q">
            Buscar en tareas
          </label>
          <input
            id="nm-hub-task-q"
            type="search"
            className="nm-hub-input nm-hub-task-search"
            placeholder="Buscar en título o detalle…"
            value={taskQuery}
            onChange={(e) => setTaskQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      ) : null}

      {!readOnly && panel === 'create' ? (
        <form id="nm-hub-tareas-nueva" className="nm-hub-card" onSubmit={(e) => void onCreate(e)}>
          <h2 className="nm-hub-card-title">Nueva tarea</h2>

          <label className="nm-hub-label" htmlFor="nm-hub-t-title">
            Título
          </label>
          <input
            id="nm-hub-t-title"
            className="nm-hub-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />

          <label className="nm-hub-label" htmlFor="nm-hub-t-body" style={{ marginTop: '0.65rem' }}>
            Detalle
          </label>
          <textarea id="nm-hub-t-body" className="nm-hub-textarea" value={body} onChange={(e) => setBody(e.target.value)} rows={3} />

          <div className="nm-hub-field-grow" style={{ marginTop: '0.65rem' }}>
            <label className="nm-hub-label" htmlFor="nm-hub-t-imp">
              Importancia
            </label>
            <select
              id="nm-hub-t-imp"
              className="nm-hub-input"
              value={importance}
              onChange={(e) => setImportance(e.target.value as HubImportance)}
            >
              {(Object.keys(IMPORTANCE_LABEL) as HubImportance[]).map((k) => (
                <option key={k} value={k}>
                  {IMPORTANCE_LABEL[k]}
                </option>
              ))}
            </select>
          </div>

          <div className="nm-hub-image-block">
            <span className="nm-hub-label" id="nm-hub-t-files-legend">
              Imágenes <span className="nm-hub-label-optional">(opcional)</span>
            </span>
            <input
              id="nm-hub-t-files"
              className="nm-hub-sr-only"
              type="file"
              accept="image/*"
              multiple
              aria-labelledby="nm-hub-t-files-legend"
              onChange={(e) => {
                const picked = e.target.files ? Array.from(e.target.files) : []
                if (picked.length > 0) setFiles((prev) => [...prev, ...picked])
                e.target.value = ''
              }}
            />
            <label htmlFor="nm-hub-t-files" className="nm-hub-image-picker-btn">
              <span className="nm-hub-image-picker-btn__icons" aria-hidden="true">
                <svg className="nm-hub-image-picker-btn__pic" viewBox="0 0 24 24" width="44" height="44" fill="none" aria-hidden="true">
                  <path
                    d="M4 7a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V7z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <circle cx="9" cy="10" r="1.35" fill="currentColor" />
                  <path d="M4 16l4.5-4.5a1 1 0 011.4 0L14 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M14 13l2-2a1 1 0 011.4 0L20 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="nm-hub-image-picker-btn__plus">+</span>
              </span>
              <span className="nm-hub-image-picker-btn__hint">Tocá para agregar · en el celular podés usar la cámara o la galería</span>
            </label>
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

          <button type="submit" className="nm-hub-btn nm-hub-btn-primary" disabled={busy} style={{ marginTop: '0.85rem', width: '100%' }}>
            {busy ? 'Guardando…' : 'Crear tarea'}
          </button>
        </form>
      ) : null}

      {panel === 'list' ? (
        <section id="nm-hub-tareas-lista" className="nm-hub-section" aria-label="Tareas del día">
          <div className="nm-hub-list-head">
            <div className="nm-hub-subtabs" role="tablist" aria-label="Tareas del día">
              <button
                type="button"
                role="tab"
                aria-selected={listMode === 'pendientes'}
                className={`nm-hub-subtab${listMode === 'pendientes' ? ' nm-hub-subtab--active' : ''}`}
                onClick={() => setListModeInUrl('pendientes')}
              >
                Pendientes
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={listMode === 'completadas'}
                className={`nm-hub-subtab${listMode === 'completadas' ? ' nm-hub-subtab--active' : ''}`}
                onClick={() => setListModeInUrl('completadas')}
              >
                Completadas
              </button>
            </div>
          </div>
          {loading ? <p className="nm-hub-muted">Cargando…</p> : null}
          {!loading && sorted.length === 0 ? (
            <p className="nm-hub-muted">{listMode === 'completadas' ? 'No hay tareas completadas este día.' : 'No hay tareas pendientes.'}</p>
          ) : null}
          {!loading && sorted.length > 0 && filteredSorted.length === 0 ? (
            <p className="nm-hub-muted">Ninguna tarea coincide con la búsqueda.</p>
          ) : null}
          <ul className="nm-hub-task-list">
            {filteredSorted.map((t) => (
              <li key={t.id} className="nm-hub-task-item">
                <div className="nm-hub-task-top">
                  <h3 className="nm-hub-task-title">{t.title}</h3>
                  <div className="nm-hub-task-importance-block">
                    <span className="nm-hub-task-importance-label">importancia</span>
                    <span className={`nm-hub-badge nm-hub-badge--${t.importance}`}>{IMPORTANCE_LABEL[t.importance]}</span>
                  </div>
                </div>
                {listMode === 'completadas' && t.executed_at ? (
                  <p className="nm-hub-task-done-meta">
                    Completada por{' '}
                    <strong>{t.executed_by ? executorNames[t.executed_by] ?? '…' : '—'}</strong>
                    {' · '}
                    {formatExecutedLabel(t.executed_at)}
                  </p>
                ) : null}
                {t.body ? <p className="nm-hub-task-body">{t.body}</p> : null}
                <TaskThumbnails paths={t.image_paths ?? []} />
                {!readOnly && listMode === 'pendientes' ? (
                  <button
                    type="button"
                    className="nm-hub-btn nm-hub-btn-primary nm-hub-task-complete-btn"
                    disabled={busy}
                    onClick={() => void onSetExecuted(t, true)}
                  >
                    Completar
                  </button>
                ) : null}
                {!readOnly && listMode === 'completadas' ? (
                  <button
                    type="button"
                    className="nm-hub-btn nm-hub-btn-ghost nm-hub-task-complete-btn"
                    disabled={busy}
                    onClick={() => void onSetExecuted(t, false)}
                  >
                    Descompletar
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
