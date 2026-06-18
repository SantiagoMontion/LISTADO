import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { HubBrandBar } from './HubBrandBar'
import { HubDesktopNav } from './HubDesktopNav'
import { hubNavigate } from '../lib/hubNavigate'
import { todayIsoLocal } from '../lib/date'
import { formatSupabaseOrError } from '../lib/errors'
import {
  aggregateCutEventsByDay,
  buildCutInsightLines,
  buildCutWeekSeries,
  computeCutAnalytics,
  formatWeekRangeDisplay,
  mondayOfWeekContaining,
  nextWeekMonday,
  previousWeekMonday,
  sumCutSeries,
  weekRangeEndFriday,
  type CutDayRecord,
} from '../lib/cutAnalytics'
import { fetchCutEventsForRange, fetchPendingCutUnitsTotal } from '../lib/nmProdCutEventsApi'
import type { HubUserRole } from '../lib/types'

const NOT_BOT_TAG = '[NOT-BOT]'

interface HubAdminCutAnalyticsProps {
  configured: boolean
  role: HubUserRole | null | undefined
  adminSignOut?: boolean
}

function formatMetric(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function CutBarChart({ series, dailyAverage }: { series: CutDayRecord[]; dailyAverage: number }) {
  const chartMax = useMemo(() => {
    const peak = Math.max(dailyAverage, ...series.map((row) => row.cantidad), 1)
    return Math.ceil(peak * 1.1)
  }, [series, dailyAverage])

  const referenceBottomPct = (dailyAverage / chartMax) * 100

  return (
    <div
      className="dispatch-bar-chart"
      role="img"
      aria-label="Gráfico de unidades cortadas de lunes a viernes"
    >
      <div className="dispatch-bar-chart__plot">
        <div
          className="dispatch-bar-chart__reference"
          style={{ bottom: `${referenceBottomPct}%` }}
          aria-hidden="true"
        >
          <span className="dispatch-bar-chart__reference-label">
            Prom. {formatMetric(dailyAverage)}
          </span>
        </div>
        <div className="dispatch-bar-chart__bars">
          {series.map((row) => {
            const heightPct = (row.cantidad / chartMax) * 100
            const aboveAverage = row.cantidad >= dailyAverage
            return (
              <div key={row.fecha} className="dispatch-bar-chart__column">
                <div className="dispatch-bar-chart__bar-wrap">
                  <div
                    className={`dispatch-bar-chart__bar${aboveAverage ? ' dispatch-bar-chart__bar--above' : ' dispatch-bar-chart__bar--below'}`}
                    style={{ height: `${heightPct}%` }}
                    title={`${row.dia}: ${row.cantidad}`}
                  />
                </div>
                <span className="dispatch-bar-chart__value">{row.cantidad}</span>
                <span className="dispatch-bar-chart__day">{row.dia.slice(0, 3)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function InsightRow({ children }: { children: ReactNode }) {
  return (
    <div className="insight-log-row">
      <span className="insight-bot-tag">{NOT_BOT_TAG}</span>
      {children}
    </div>
  )
}

export function HubAdminCutAnalytics({
  configured,
  role,
  adminSignOut = false,
}: HubAdminCutAnalyticsProps) {
  const currentWeekMonday = useMemo(() => mondayOfWeekContaining(todayIsoLocal()), [])
  const [selectedWeekMonday, setSelectedWeekMonday] = useState(currentWeekMonday)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<{ cut_at: string; qty: number }[]>([])
  const [pendingUnits, setPendingUnits] = useState(0)

  const weekEnd = useMemo(() => weekRangeEndFriday(selectedWeekMonday), [selectedWeekMonday])
  const prevMonday = useMemo(() => previousWeekMonday(selectedWeekMonday), [selectedWeekMonday])
  const prevWeekEnd = useMemo(() => weekRangeEndFriday(prevMonday), [prevMonday])
  const weekRangeLabel = useMemo(
    () => formatWeekRangeDisplay(selectedWeekMonday, weekEnd),
    [selectedWeekMonday, weekEnd],
  )
  const canGoForward = selectedWeekMonday < currentWeekMonday

  const currentWeek = useMemo(() => {
    const totals = aggregateCutEventsByDay(events, selectedWeekMonday, weekEnd)
    return buildCutWeekSeries(totals, selectedWeekMonday)
  }, [events, selectedWeekMonday, weekEnd])

  const previousWeekTotal = useMemo(() => {
    const totals = aggregateCutEventsByDay(events, prevMonday, prevWeekEnd)
    return sumCutSeries(buildCutWeekSeries(totals, prevMonday))
  }, [events, prevMonday, prevWeekEnd])

  const analytics = useMemo(
    () => computeCutAnalytics(currentWeek, previousWeekTotal),
    [currentWeek, previousWeekTotal],
  )

  const estimacionDias = useMemo(() => {
    if (analytics.dailyAverage <= 0 || pendingUnits <= 0) return null
    return Math.ceil(pendingUnits / analytics.dailyAverage)
  }, [analytics.dailyAverage, pendingUnits])

  const insightLines = useMemo(
    () => buildCutInsightLines(analytics, analytics.criticalDay, estimacionDias),
    [analytics, estimacionDias],
  )

  const shiftWeek = useCallback((direction: -1 | 1) => {
    setSelectedWeekMonday((prev) =>
      direction < 0 ? previousWeekMonday(prev) : nextWeekMonday(prev),
    )
  }, [])

  const loadData = useCallback(async () => {
    if (!configured) {
      setEvents([])
      setPendingUnits(0)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [cutEvents, pending] = await Promise.all([
        fetchCutEventsForRange(prevMonday, weekEnd),
        fetchPendingCutUnitsTotal(),
      ])
      setEvents(cutEvents)
      setPendingUnits(pending)
    } catch (err: unknown) {
      setError(formatSupabaseOrError(err))
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [configured, prevMonday, weekEnd])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (role !== 'admin') hubNavigate('/')
  }, [role])

  if (role !== 'admin') {
    return (
      <div className="nm-hub-app">
        <p className="nm-hub-muted">Redirigiendo…</p>
      </div>
    )
  }

  const criticalDayName = analytics.criticalDay?.name ?? '—'
  const criticalPct = analytics.criticalDay?.percentage ?? 0

  return (
    <div className="nm-hub-app nm-hub-app--cut-analytics">
      <header className="dashboard-navbar dashboard-navbar-clean nm-hub-header">
        <HubBrandBar
          integratedDashboard
          adminSignOut={adminSignOut}
          integratedSubtitle="Corte Semanal"
          integratedSubtitleTone="muted"
        />
      </header>

      <HubDesktopNav role={role} />

      <div className="admin-analytics-holder">
        <section className="week-pager-rebel" aria-label="Semana de consulta">
          <button
            type="button"
            className="week-pager-btn"
            onClick={() => shiftWeek(-1)}
            disabled={!configured || loading}
            aria-label="Semana anterior"
          >
            ←
          </button>
          <span className="week-range-text" aria-live="polite">
            {weekRangeLabel}
            {loading ? ' …' : null}
          </span>
          <button
            type="button"
            className="week-pager-btn"
            onClick={() => shiftWeek(1)}
            disabled={!configured || loading || !canGoForward}
            aria-label="Semana siguiente"
          >
            →
          </button>
        </section>

        {error ? (
          <p className="nm-hub-error admin-analytics-holder__feedback" role="alert">
            {error}
          </p>
        ) : null}

        {!configured ? (
          <p className="nm-hub-muted admin-analytics-holder__feedback">
            Configurá Supabase en <code>.env</code> para ver analítica de corte.
          </p>
        ) : null}

        <section className="kpi-analytics-grid" aria-label="Indicadores de corte">
          <article className="kpi-card-rebel">
            <span className="kpi-card-label">Total cortado</span>
            <span className="kpi-card-number">{analytics.weeklyTotal}</span>
            <span className="kpi-card-subtext">unidades en la semana</span>
          </article>
          <article className="kpi-card-rebel">
            <span className="kpi-card-label">Promedio diario</span>
            <span className="kpi-card-number">{formatMetric(analytics.dailyAverage)}</span>
            <span className="kpi-card-subtext">unidades / día L-V</span>
          </article>
          <article
            className={`kpi-card-rebel${analytics.criticalDay ? ' alert-critical' : ''}`}
          >
            <span className="kpi-card-label">Baja de ritmo</span>
            <span className="kpi-card-number">{criticalDayName}</span>
            <span className="kpi-card-subtext">
              {analytics.criticalDay ? `-${criticalPct}% menos` : 'sin caída'}
            </span>
          </article>
        </section>

        <section className="chart-card-wrapper" aria-label="Rendimiento de corte">
          <h3 className="chart-card-wrapper__title">Unidades cortadas por día</h3>
          <CutBarChart series={currentWeek} dailyAverage={analytics.dailyAverage} />
        </section>

        <section className="insights-log-box" aria-label="Sugerencias de producción">
          <h3 className="insights-log-box__title modal-section-label">Sugerencias de producción</h3>

          {estimacionDias !== null && estimacionDias > 0 ? (
            <InsightRow>
              El ritmo de corte actual indica que el stock de tela rinde para aproximadamente{' '}
              {estimacionDias} días de trabajo estable.
            </InsightRow>
          ) : null}

          {analytics.criticalDay ? (
            <InsightRow>
              Se detecta menor actividad de corte los {criticalDayName.toLowerCase()}. Se sugiere
              balancear las asignaciones.
            </InsightRow>
          ) : null}

          {insightLines.map((line) => (
            <InsightRow key={line}>{line}</InsightRow>
          ))}
        </section>
      </div>
    </div>
  )
}
