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
  TREND_SOURCE_LABELS,
  upsertTrendTask,
  type TrendAlert,
  type TrendAnalyzedFeedItem,
  type TrendSearchGoal,
  type TrendSearchTask,
  type TrendTaskConfig,
} from '../lib/trendsApi'
import type { HubUserRole } from '../lib/types'

interface HubTrendsAppProps {
  configured: boolean
  role: HubUserRole | null | undefined
  adminSignOut?: boolean
}

type TabId = 'buscar' | 'feed' | 'alerts'

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

const GOAL_OPTIONS: Array<{ id: TrendSearchGoal; label: string; hint: string }> = [
  { id: 'both', label: 'Producto + contenido', hint: 'Merch/importados e ideas de posts/reels' },
  { id: 'product', label: 'Solo producto', hint: 'Enfoque en oportunidades de vender / importar' },
  { id: 'content', label: 'Solo contenido', hint: 'Enfoque en ideas de marketing / redes' },
]

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
  if (!iso) return 'Nunca'
  try {
    return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function goalLabel(goal: string | undefined): string {
  return GOAL_OPTIONS.find((g) => g.id === goal)?.label ?? 'Producto + contenido'
}

export function HubTrendsApp({
  configured,
  role,
  adminSignOut = false,
}: HubTrendsAppProps) {
  const [tab, setTab] = useState<TabId>('buscar')
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
  const [formContext, setFormContext] = useState('')
  const [formGoal, setFormGoal] = useState<TrendSearchGoal>('both')
  const [formMinutes, setFormMinutes] = useState(30)
  const [formActive, setFormActive] = useState(true)
  const [formKeywords, setFormKeywords] = useState('')
  const [formMust, setFormMust] = useState('')
  const [formExclude, setFormExclude] = useState('')
  const [formNews, setFormNews] = useState('')
  const [formSubs, setFormSubs] = useState('')
  const [formYt, setFormYt] = useState('')
  const [formRss, setFormRss] = useState('')
  const [formGeos, setFormGeos] = useState('AR\nUS')
  const [formBsky, setFormBsky] = useState('')
  const [formSources, setFormSources] = useState<string[]>([...SOURCE_OPTIONS.slice(0, 6)])
  const [runAfterSave, setRunAfterSave] = useState(true)

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
      if (!t.length) setTab('buscar')
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

  const searchPreview = useMemo(() => {
    const kw = linesToList(formKeywords)
    const news = linesToList(formNews)
    const must = linesToList(formMust)
    const parts = [
      formName.trim() || 'Sin nombre',
      goalLabel(formGoal),
      kw.length ? `${kw.length} keywords` : null,
      news.length ? `${news.length} queries noticias` : null,
      must.length ? `${must.length} obligatorios` : null,
      `${formSources.length} fuentes`,
    ].filter(Boolean)
    return parts.join(' · ')
  }, [formName, formGoal, formKeywords, formNews, formMust, formSources])

  function resetForm() {
    setEditingId(null)
    setFormName('')
    setFormContext('')
    setFormGoal('both')
    setFormMinutes(30)
    setFormActive(true)
    setFormKeywords('')
    setFormMust('')
    setFormExclude('')
    setFormNews('')
    setFormSubs('')
    setFormYt('')
    setFormRss('')
    setFormGeos('AR\nUS')
    setFormBsky('')
    setFormSources([...SOURCE_OPTIONS.slice(0, 6)])
    setRunAfterSave(true)
  }

  function startEdit(task: TrendSearchTask) {
    setEditingId(task.id)
    setFormName(task.name)
    setFormContext(task.config.context || '')
    setFormGoal(task.config.goal || 'both')
    setFormMinutes(task.schedule_minutes)
    setFormActive(task.is_active)
    setFormKeywords(listToLines(task.config.keywords))
    setFormMust(listToLines(task.config.must_include))
    setFormExclude(listToLines(task.config.exclude))
    setFormNews(listToLines(task.config.news_queries))
    setFormSubs(listToLines(task.config.subreddits))
    setFormYt(listToLines(task.config.youtube_channel_ids))
    setFormRss(listToLines(task.config.rss_feeds))
    setFormGeos(listToLines(task.config.trends_geos.length ? task.config.trends_geos : ['AR', 'US']))
    setFormBsky(listToLines(task.config.bluesky_queries))
    setFormSources(
      task.config.sources_enabled.length
        ? task.config.sources_enabled
        : [...SOURCE_OPTIONS.slice(0, 6)],
    )
    setTab('buscar')
  }

  function buildConfig(): TrendTaskConfig {
    const keywords = linesToList(formKeywords)
    const news = linesToList(formNews)
    const bsky = linesToList(formBsky)
    return {
      ...emptyTrendTaskConfig(),
      context: formContext.trim(),
      goal: formGoal,
      keywords,
      must_include: linesToList(formMust),
      exclude: linesToList(formExclude),
      news_queries: news.length ? news : keywords.slice(0, 3),
      subreddits: linesToList(formSubs),
      youtube_channel_ids: linesToList(formYt),
      rss_feeds: linesToList(formRss),
      trends_geos: linesToList(formGeos).map((g) => g.toUpperCase()),
      bluesky_queries: bsky.length ? bsky : keywords.slice(0, 3),
      sources_enabled: formSources,
    }
  }

  async function onSaveTask(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    if (!formName.trim()) {
      setError('Poné un nombre a la búsqueda.')
      return
    }
    if (!linesToList(formKeywords).length && !linesToList(formNews).length) {
      setError('Agregá al menos keywords o queries de noticias.')
      return
    }
    if (!formSources.length) {
      setError('Elegí al menos una fuente.')
      return
    }

    try {
      const config = buildConfig()
      const saved = await upsertTrendTask({
        id: editingId ?? undefined,
        name: formName.trim(),
        niche: formName.trim().toLowerCase(),
        schedule_minutes: formMinutes,
        is_active: formActive,
        config,
      })
      setInfo(editingId ? 'Búsqueda actualizada' : 'Búsqueda creada')
      const shouldRun = runAfterSave
      resetForm()
      await loadAll()
      if (shouldRun) {
        setTab('feed')
        await onRun(saved.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function onDeleteTask(id: string) {
    if (!window.confirm('¿Borrar esta búsqueda y sus resultados?')) return
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
        `Listo — búsquedas ${summary.tasksProcessed}, nuevos ${summary.itemsInserted}, analizados ${summary.itemsAnalyzed}, alertas ${summary.alertsCreated}`,
      )
      await loadAll()
      setTab('feed')
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
            <h1 className="hub-trends__title">Buscador de tendencias</h1>
            <p className="hub-trends__lead">
              Armá vos qué vigilar: contexto, keywords, fuentes y objetivo (producto / contenido).
            </p>
          </div>
          <div className="hub-trends__actions">
            <button
              type="button"
              className="nm-hub-btn nm-hub-btn--primary"
              disabled={running || !tasks.some((t) => t.is_active)}
              onClick={() => void onRun()}
            >
              {running ? 'Buscando…' : 'Correr activas'}
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
            className={`hub-trends__tab${tab === 'buscar' ? ' is-active' : ''}`}
            onClick={() => setTab('buscar')}
          >
            Mis búsquedas
          </button>
          <button
            type="button"
            className={`hub-trends__tab${tab === 'feed' ? ' is-active' : ''}`}
            onClick={() => setTab('feed')}
          >
            Resultados
          </button>
          <button
            type="button"
            className={`hub-trends__tab${tab === 'alerts' ? ' is-active' : ''}`}
            onClick={() => setTab('alerts')}
          >
            Alertas{unreadCount ? ` (${unreadCount})` : ''}
          </button>
        </div>

        {tab === 'buscar' ? (
          <section className="hub-trends__section hub-trends__section--split">
            <div>
              <h2 className="hub-trends__subtitle">Guardadas</h2>
              {!loading && !tasks.length ? (
                <p className="nm-hub-muted">
                  No hay búsquedas todavía. Completá el formulario de la derecha y guardá la tuya.
                </p>
              ) : null}
              <ul className="hub-trends__tasks">
                {tasks.map((task) => (
                  <li key={task.id} className="hub-trends__task">
                    <div>
                      <strong>
                        {task.name}{' '}
                        <span className="nm-hub-muted">
                          ({task.is_active ? 'activa' : 'pausada'})
                        </span>
                      </strong>
                      <p className="nm-hub-muted">
                        {goalLabel(task.config.goal)} · cada {task.schedule_minutes} min · último{' '}
                        {formatWhen(task.last_run_at)}
                      </p>
                      {task.config.context ? (
                        <p className="hub-trends__task-context">{task.config.context}</p>
                      ) : null}
                      <p className="hub-trends__task-tags">
                        {(task.config.keywords.slice(0, 6) || []).map((k) => (
                          <span key={k} className="hub-trends__chip">
                            {k}
                          </span>
                        ))}
                      </p>
                    </div>
                    <div className="hub-trends__task-actions">
                      <button type="button" className="nm-hub-btn" onClick={() => startEdit(task)}>
                        Editar
                      </button>
                      <button
                        type="button"
                        className="nm-hub-btn nm-hub-btn--primary"
                        disabled={running}
                        onClick={() => void onRun(task.id)}
                      >
                        Buscar
                      </button>
                      <button
                        type="button"
                        className="nm-hub-btn"
                        onClick={() => void onDeleteTask(task.id)}
                      >
                        Borrar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <form className="hub-trends__form" onSubmit={(e) => void onSaveTask(e)}>
              <h2 className="hub-trends__subtitle">
                {editingId ? 'Editar búsqueda' : 'Nueva búsqueda manual'}
              </h2>
              <p className="hub-trends__form-hint">{searchPreview}</p>

              <label>
                Nombre de la búsqueda
                <input
                  className="nm-hub-input"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ej: Figuras anime trending AR / Drop streetwear"
                  required
                />
              </label>

              <label>
                Contexto (qué te importa y por qué)
                <textarea
                  className="nm-hub-input"
                  rows={4}
                  value={formContext}
                  onChange={(e) => setFormContext(e.target.value)}
                  placeholder="Ej: Busco personajes/anime que estén explotando para importar figuras o merch. También quiero hooks para reels. Ignorar spoilers pesados y politics."
                />
              </label>

              <fieldset className="hub-trends__sources">
                <legend>Objetivo</legend>
                {GOAL_OPTIONS.map((opt) => (
                  <label key={opt.id} className="hub-trends__check hub-trends__check--block">
                    <input
                      type="radio"
                      name="goal"
                      checked={formGoal === opt.id}
                      onChange={() => setFormGoal(opt.id)}
                    />
                    <span>
                      <strong>{opt.label}</strong>
                      <span className="nm-hub-muted"> — {opt.hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <label>
                Keywords principales (una por línea)
                <textarea
                  className="nm-hub-input"
                  rows={4}
                  value={formKeywords}
                  onChange={(e) => setFormKeywords(e.target.value)}
                  placeholder={'zenitsu\nfigurine\nanime merch\ndemon slayer'}
                />
              </label>

              <label>
                Debe incluir al menos uno (filtro duro, opcional)
                <textarea
                  className="nm-hub-input"
                  rows={2}
                  value={formMust}
                  onChange={(e) => setFormMust(e.target.value)}
                  placeholder={'figurine\nfigure\nmerch'}
                />
              </label>

              <label>
                Excluir (si aparece, se descarta)
                <textarea
                  className="nm-hub-input"
                  rows={2}
                  value={formExclude}
                  onChange={(e) => setFormExclude(e.target.value)}
                  placeholder={'spoiler\npolitics\nnsfw'}
                />
              </label>

              <label>
                Queries de noticias (Google News, una por línea)
                <textarea
                  className="nm-hub-input"
                  rows={3}
                  value={formNews}
                  onChange={(e) => setFormNews(e.target.value)}
                  placeholder={'anime figures trending\nbest anime merch 2026'}
                />
                <span className="hub-trends__field-help">
                  Si lo dejás vacío, usa las keywords. Se arman feeds de Google News solos.
                </span>
              </label>

              <label>
                Países Trends / News (AR, US, MX…)
                <textarea
                  className="nm-hub-input"
                  rows={2}
                  value={formGeos}
                  onChange={(e) => setFormGeos(e.target.value)}
                />
              </label>

              <label>
                Subreddits (sin r/)
                <textarea
                  className="nm-hub-input"
                  rows={2}
                  value={formSubs}
                  onChange={(e) => setFormSubs(e.target.value)}
                  placeholder={'anime\nFigurines\nAnimeFigures'}
                />
              </label>

              <label>
                Queries Bluesky (opcional; si vacío = keywords)
                <textarea
                  className="nm-hub-input"
                  rows={2}
                  value={formBsky}
                  onChange={(e) => setFormBsky(e.target.value)}
                />
              </label>

              <label>
                YouTube channel IDs (opcional)
                <textarea
                  className="nm-hub-input"
                  rows={2}
                  value={formYt}
                  onChange={(e) => setFormYt(e.target.value)}
                  placeholder="UCxxxx…"
                />
              </label>

              <label>
                RSS extra (URLs, opcional)
                <textarea
                  className="nm-hub-input"
                  rows={2}
                  value={formRss}
                  onChange={(e) => setFormRss(e.target.value)}
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
                    {TREND_SOURCE_LABELS[src] ?? src}
                  </label>
                ))}
              </fieldset>

              <label>
                Intervalo automático (min)
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
                Activa en el cron
              </label>

              <label className="hub-trends__check">
                <input
                  type="checkbox"
                  checked={runAfterSave}
                  onChange={(e) => setRunAfterSave(e.target.checked)}
                />{' '}
                Buscar ahora al guardar
              </label>

              <div className="hub-trends__form-actions">
                <button type="submit" className="nm-hub-btn nm-hub-btn--primary" disabled={running}>
                  {editingId ? 'Guardar cambios' : 'Crear búsqueda'}
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

        {tab === 'feed' ? (
          <section className="hub-trends__section">
            <div className="hub-trends__filters">
              <label>
                Búsqueda{' '}
                <select
                  value={taskFilter}
                  onChange={(e) => setTaskFilter(e.target.value)}
                  className="nm-hub-input"
                >
                  <option value="">Todas</option>
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
                Sin resultados. Creá una búsqueda en «Mis búsquedas» y tocá Buscar.
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
                        <span>{TREND_SOURCE_LABELS[item.raw?.source ?? ''] ?? item.raw?.source}</span>
                        <span>viral {item.virality_score}</span>
                        <span>rel {item.relevance}</span>
                        {item.is_emerging ? (
                          <span className="hub-trends__badge">emergente</span>
                        ) : null}
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
                    <p className="hub-trends__alert-body">{alert.body}</p>
                    <span className="hub-trends__when">
                      {alert.severity} · {formatWhen(alert.created_at)}
                    </span>
                  </div>
                  {!alert.is_read ? (
                    <button
                      type="button"
                      className="nm-hub-btn"
                      onClick={() => void onReadAlert(alert.id)}
                    >
                      Marcar leída
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  )
}
