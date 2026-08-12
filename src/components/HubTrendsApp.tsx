import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { HubBrandBar } from './HubBrandBar'
import { HubDesktopNav } from './HubDesktopNav'
import { hubNavigate } from '../lib/hubNavigate'
import {
  deleteTrendTask,
  emptyTrendTaskConfig,
  listTrendAlerts,
  listTrendFeed,
  listTrendTasks,
  markTrendAlertRead,
  runTrendsNow,
  upsertTrendTask,
  type TrendAlert,
  type TrendAnalyzedFeedItem,
  type TrendSearchTask,
  type TrendTaskConfig,
} from '../lib/trendsApi'
import type { HubUserRole } from '../lib/types'

interface HubTrendsAppProps {
  configured: boolean
  role: HubUserRole | null | undefined
  adminSignOut?: boolean
}

type TabId = 'feed' | 'alerts' | 'tasks'

const SOURCE_OPTIONS = [
  'reddit',
  'youtube',
  'rss',
  'gtrends_rss',
  'hn',
  'bluesky',
  'arxiv',
  'lobsters',
] as const

function linesToList(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function listToLines(list: string[]): string {
  return list.join('\n')
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export function HubTrendsApp({
  configured,
  role,
  adminSignOut = false,
}: HubTrendsAppProps) {
  const [tab, setTab] = useState<TabId>('feed')
  const [tasks, setTasks] = useState<TrendSearchTask[]>([])
  const [feed, setFeed] = useState<TrendAnalyzedFeedItem[]>([])
  const [alerts, setAlerts] = useState<TrendAlert[]>([])
  const [taskFilter, setTaskFilter] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formNiche, setFormNiche] = useState('')
  const [formMinutes, setFormMinutes] = useState(30)
  const [formActive, setFormActive] = useState(true)
  const [formKeywords, setFormKeywords] = useState('')
  const [formSubs, setFormSubs] = useState('')
  const [formYt, setFormYt] = useState('')
  const [formRss, setFormRss] = useState('')
  const [formGeos, setFormGeos] = useState('AR\nUS\nMX')
  const [formBsky, setFormBsky] = useState('')
  const [formSources, setFormSources] = useState<string[]>([...SOURCE_OPTIONS.slice(0, 6)])

  useEffect(() => {
    if (!role) hubNavigate('/')
  }, [role])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [t, f, a] = await Promise.all([
        listTrendTasks(),
        listTrendFeed({ taskId: taskFilter || undefined, limit: 80 }),
        listTrendAlerts(50),
      ])
      setTasks(t)
      setFeed(f)
      setAlerts(a)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [taskFilter])

  useEffect(() => {
    if (role) void loadAll()
  }, [role, loadAll])

  const unreadCount = useMemo(() => alerts.filter((a) => !a.is_read).length, [alerts])

  function resetForm() {
    setEditingId(null)
    setFormName('')
    setFormNiche('')
    setFormMinutes(30)
    setFormActive(true)
    setFormKeywords('')
    setFormSubs('')
    setFormYt('')
    setFormRss('')
    setFormGeos('AR\nUS\nMX')
    setFormBsky('')
    setFormSources([...SOURCE_OPTIONS.slice(0, 6)])
  }

  function startEdit(task: TrendSearchTask) {
    setEditingId(task.id)
    setFormName(task.name)
    setFormNiche(task.niche)
    setFormMinutes(task.schedule_minutes)
    setFormActive(task.is_active)
    setFormKeywords(listToLines(task.config.keywords))
    setFormSubs(listToLines(task.config.subreddits))
    setFormYt(listToLines(task.config.youtube_channel_ids))
    setFormRss(listToLines(task.config.rss_feeds))
    setFormGeos(listToLines(task.config.trends_geos))
    setFormBsky(listToLines(task.config.bluesky_queries))
    setFormSources(task.config.sources_enabled)
    setTab('tasks')
  }

  async function onSaveTask(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    try {
      const config: TrendTaskConfig = {
        ...emptyTrendTaskConfig(),
        keywords: linesToList(formKeywords),
        subreddits: linesToList(formSubs),
        youtube_channel_ids: linesToList(formYt),
        rss_feeds: linesToList(formRss),
        trends_geos: linesToList(formGeos).map((g) => g.toUpperCase()),
        bluesky_queries: linesToList(formBsky),
        sources_enabled: formSources,
      }
      await upsertTrendTask({
        id: editingId ?? undefined,
        name: formName,
        niche: formNiche || formName.toLowerCase(),
        schedule_minutes: formMinutes,
        is_active: formActive,
        config,
      })
      setInfo(editingId ? 'Tarea actualizada' : 'Tarea creada')
      resetForm()
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function onDeleteTask(id: string) {
    if (!window.confirm('¿Borrar esta tarea y sus datos asociados?')) return
    try {
      await deleteTrendTask(id)
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function onRun(taskId?: string) {
    setRunning(true)
    setError(null)
    setInfo(null)
    try {
      const summary = await runTrendsNow(taskId)
      setInfo(
        `Run OK — tasks ${summary.tasksProcessed}, nuevos ${summary.itemsInserted}, analizados ${summary.itemsAnalyzed}, alertas ${summary.alertsCreated}`,
      )
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  async function onReadAlert(id: string) {
    try {
      await markTrendAlertRead(id)
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, is_read: true } : a)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!role) {
    return (
      <div className="nm-hub-app">
        <p className="nm-hub-muted">Redirigiendo…</p>
      </div>
    )
  }

  if (!configured) {
    return (
      <div className="nm-hub-app">
        <p className="nm-hub-error">Supabase no configurado.</p>
      </div>
    )
  }

  return (
    <div className="nm-hub-app nm-hub-app--trends">
      <header className="dashboard-navbar dashboard-navbar-clean nm-hub-header">
        <HubBrandBar
          integratedDashboard
          adminSignOut={adminSignOut}
          integratedSubtitle="Tendencias"
          integratedSubtitleTone="muted"
        />
      </header>

      <HubDesktopNav role={role} />

      <div className="hub-trends">
        <header className="hub-trends__head">
          <div>
            <h1 className="hub-trends__title">Vigilancia de tendencias</h1>
            <p className="hub-trends__lead">
              Solo usuarios logueados. Fuentes gratis: Reddit, YouTube, RSS, Google Trends, HN, Bluesky…
            </p>
          </div>
          <div className="hub-trends__actions">
            <button
              type="button"
              className="nm-hub-btn nm-hub-btn--primary"
              disabled={running}
              onClick={() => void onRun()}
            >
              {running ? 'Corriendo…' : 'Correr ahora'}
            </button>
            <button type="button" className="nm-hub-btn" disabled={loading} onClick={() => void loadAll()}>
              Refrescar
            </button>
          </div>
        </header>

        {error ? (
          <p className="nm-hub-error" role="alert">
            {error}
          </p>
        ) : null}
        {info ? (
          <p className="nm-hub-muted" role="status">
            {info}
          </p>
        ) : null}

        <div className="hub-trends__tabs" role="tablist">
          <button
            type="button"
            className={`hub-trends__tab${tab === 'feed' ? ' is-active' : ''}`}
            onClick={() => setTab('feed')}
          >
            Feed
          </button>
          <button
            type="button"
            className={`hub-trends__tab${tab === 'alerts' ? ' is-active' : ''}`}
            onClick={() => setTab('alerts')}
          >
            Alertas{unreadCount ? ` (${unreadCount})` : ''}
          </button>
          <button
            type="button"
            className={`hub-trends__tab${tab === 'tasks' ? ' is-active' : ''}`}
            onClick={() => setTab('tasks')}
          >
            Tareas
          </button>
        </div>

        {tab === 'feed' ? (
          <section className="hub-trends__section">
            <div className="hub-trends__filters">
              <label>
                Nicho{' '}
                <select
                  value={taskFilter}
                  onChange={(e) => setTaskFilter(e.target.value)}
                  className="nm-hub-input"
                >
                  <option value="">Todos</option>
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {loading ? <p className="nm-hub-muted">Cargando…</p> : null}
            {!loading && !feed.length ? (
              <p className="nm-hub-muted">
                Todavía no hay análisis. Creá/activá tareas y tocá «Correr ahora».
              </p>
            ) : null}

            <ul className="hub-trends__feed">
              {feed.map((item) => {
                const thumb = item.raw?.media?.[0]?.url
                return (
                  <li key={item.id} className="hub-trends__card">
                    {thumb ? (
                      <img className="hub-trends__thumb" src={thumb} alt="" loading="lazy" />
                    ) : (
                      <div className="hub-trends__thumb hub-trends__thumb--empty" />
                    )}
                    <div className="hub-trends__card-body">
                      <div className="hub-trends__meta">
                        <span>{item.task?.name ?? '—'}</span>
                        <span>{item.raw?.source ?? '—'}</span>
                        <span>viral {item.virality_score}</span>
                        <span>rel {item.relevance}</span>
                        {item.is_emerging ? <span className="hub-trends__badge">emergente</span> : null}
                      </div>
                      <h2 className="hub-trends__card-title">
                        {item.raw?.url ? (
                          <a href={item.raw.url} target="_blank" rel="noreferrer">
                            {item.raw.title}
                          </a>
                        ) : (
                          item.raw?.title ?? 'Sin título'
                        )}
                      </h2>
                      <p className="hub-trends__summary">{item.impact_summary}</p>
                      {item.product_angle ? (
                        <p className="hub-trends__angle">
                          <strong>Producto:</strong> {item.product_angle}
                        </p>
                      ) : null}
                      {item.content_angle ? (
                        <p className="hub-trends__angle">
                          <strong>Contenido:</strong> {item.content_angle}
                        </p>
                      ) : null}
                      <p className="hub-trends__when">{formatWhen(item.analyzed_at)}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}

        {tab === 'alerts' ? (
          <section className="hub-trends__section">
            {!alerts.length ? <p className="nm-hub-muted">Sin alertas todavía.</p> : null}
            <ul className="hub-trends__alerts">
              {alerts.map((alert) => (
                <li
                  key={alert.id}
                  className={`hub-trends__alert${alert.is_read ? '' : ' is-unread'}`}
                >
                  <div>
                    <strong>{alert.title}</strong>
                    <p>{alert.body}</p>
                    <span className="hub-trends__when">
                      {alert.severity} · {formatWhen(alert.created_at)}
                    </span>
                  </div>
                  {!alert.is_read ? (
                    <button type="button" className="nm-hub-btn" onClick={() => void onReadAlert(alert.id)}>
                      Marcar leída
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {tab === 'tasks' ? (
          <section className="hub-trends__section hub-trends__section--split">
            <div>
              <h2 className="hub-trends__subtitle">Tareas activas</h2>
              <ul className="hub-trends__tasks">
                {tasks.map((task) => (
                  <li key={task.id} className="hub-trends__task">
                    <div>
                      <strong>
                        {task.name}{' '}
                        <span className="nm-hub-muted">({task.is_active ? 'activa' : 'pausa'})</span>
                      </strong>
                      <p className="nm-hub-muted">
                        cada {task.schedule_minutes} min · último {formatWhen(task.last_run_at)}
                      </p>
                    </div>
                    <div className="hub-trends__task-actions">
                      <button type="button" className="nm-hub-btn" onClick={() => startEdit(task)}>
                        Editar
                      </button>
                      <button
                        type="button"
                        className="nm-hub-btn"
                        disabled={running}
                        onClick={() => void onRun(task.id)}
                      >
                        Run
                      </button>
                      <button type="button" className="nm-hub-btn" onClick={() => void onDeleteTask(task.id)}>
                        Borrar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <form className="hub-trends__form" onSubmit={(e) => void onSaveTask(e)}>
              <h2 className="hub-trends__subtitle">{editingId ? 'Editar tarea' : 'Nueva tarea'}</h2>
              <label>
                Nombre
                <input
                  className="nm-hub-input"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                />
              </label>
              <label>
                Nicho
                <input
                  className="nm-hub-input"
                  value={formNiche}
                  onChange={(e) => setFormNiche(e.target.value)}
                  placeholder="gaming / anime / ai"
                />
              </label>
              <label>
                Intervalo (min)
                <input
                  className="nm-hub-input"
                  type="number"
                  min={15}
                  max={180}
                  value={formMinutes}
                  onChange={(e) => setFormMinutes(Number(e.target.value) || 30)}
                />
              </label>
              <label className="hub-trends__check">
                <input
                  type="checkbox"
                  checked={formActive}
                  onChange={(e) => setFormActive(e.target.checked)}
                />{' '}
                Activa
              </label>
              <label>
                Keywords (una por línea)
                <textarea
                  className="nm-hub-input"
                  rows={3}
                  value={formKeywords}
                  onChange={(e) => setFormKeywords(e.target.value)}
                />
              </label>
              <label>
                Subreddits
                <textarea
                  className="nm-hub-input"
                  rows={2}
                  value={formSubs}
                  onChange={(e) => setFormSubs(e.target.value)}
                />
              </label>
              <label>
                YouTube channel IDs
                <textarea
                  className="nm-hub-input"
                  rows={2}
                  value={formYt}
                  onChange={(e) => setFormYt(e.target.value)}
                />
              </label>
              <label>
                RSS feeds (URLs)
                <textarea
                  className="nm-hub-input"
                  rows={3}
                  value={formRss}
                  onChange={(e) => setFormRss(e.target.value)}
                />
              </label>
              <label>
                Trends geos (AR, US…)
                <textarea
                  className="nm-hub-input"
                  rows={2}
                  value={formGeos}
                  onChange={(e) => setFormGeos(e.target.value)}
                />
              </label>
              <label>
                Bluesky queries
                <textarea
                  className="nm-hub-input"
                  rows={2}
                  value={formBsky}
                  onChange={(e) => setFormBsky(e.target.value)}
                />
              </label>
              <fieldset className="hub-trends__sources">
                <legend>Fuentes</legend>
                {SOURCE_OPTIONS.map((src) => (
                  <label key={src} className="hub-trends__check">
                    <input
                      type="checkbox"
                      checked={formSources.includes(src)}
                      onChange={(e) => {
                        setFormSources((prev) =>
                          e.target.checked ? [...prev, src] : prev.filter((x) => x !== src),
                        )
                      }}
                    />{' '}
                    {src}
                  </label>
                ))}
              </fieldset>
              <div className="hub-trends__form-actions">
                <button type="submit" className="nm-hub-btn nm-hub-btn--primary">
                  Guardar
                </button>
                {editingId ? (
                  <button type="button" className="nm-hub-btn" onClick={resetForm}>
                    Cancelar
                  </button>
                ) : null}
              </div>
            </form>
          </section>
        ) : null}
      </div>
    </div>
  )
}
