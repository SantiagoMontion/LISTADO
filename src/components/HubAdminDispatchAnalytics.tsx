import { useCallback, useEffect, useMemo, useState } from 'react'
import { HubBrandBar } from './HubBrandBar'
import { hubNavigate } from '../lib/hubNavigate'
import { todayIsoLocal } from '../lib/date'
import { formatSupabaseOrError } from '../lib/errors'
import {
  buildDispatchInsightLines,
  buildWeekDispatchSeries,
  computeDispatchAnalytics,
  mondayOfWeekContaining,
  previousWeekMonday,
  sumDispatchSeries,
  weekRangeEndSaturday,
  type DispatchDayRecord,
} from '../lib/dispatchAnalytics'
import { fetchHubDispatchedCountsForRange } from '../lib/hubDispatchedOrdersApi'
import type { HubUserRole } from '../lib/types'

interface HubAdminDispatchAnalyticsProps {
  configured: boolean
  role: HubUserRole | null | undefined
  adminSignOut?: boolean
}

function formatMetric(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

interface DispatchBarChartProps {
  series: DispatchDayRecord[]
  dailyAverage: number
}

function DispatchBarChart({ series, dailyAverage }: DispatchBarChartProps) {
  const chartMax = useMemo(() => {
    const peak = Math.max(dailyAverage, ...series.map((row) => row.despachados), 1)
    return Math.ceil(peak * 1.1)
  }, [series, dailyAverage])

  const referenceBottomPct = (dailyAverage / chartMax) * 100

  return (
    <div
      className="dispatch-bar-chart"
      role="img"
      aria-label="Gráfico de barras de despachos de lunes a sábado con línea de promedio diario"
    >
      <div className="dispatch-bar-chart__plot">
        <div
          className="chart-reference-line"
          style={{ bottom: `${referenceBottomPct}%` }}
          aria-hidden="true"
        >
          <span className="chart-reference-line__label">
            Promedio {formatMetric(dailyAverage)}
          </span>
        </div>

        <div className="dispatch-bar-chart__bars">
          {series.map((row) => {
            const heightPct = (row.despachados / chartMax) * 100
            const aboveAverage = row.despachados >= dailyAverage
            return (
              <div key={row.fecha} className="dispatch-bar-chart__column">
                <div className="dispatch-bar-chart__bar-wrap">
                  <div
                    className={`dispatch-bar-chart__bar${aboveAverage ? ' dispatch-bar-chart__bar--above-avg' : ' dispatch-bar-chart__bar--below-avg'}`}
                    style={{ height: `${heightPct}%` }}
                    title={`${row.dia}: ${row.despachados}`}
                  />
                </div>
                <span className="dispatch-bar-chart__value">{row.despachados}</span>
                <span className="dispatch-bar-chart__day">{row.dia.slice(0, 3)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function HubAdminDispatchAnalytics({
  configured,
  role,
  adminSignOut = false,
}: HubAdminDispatchAnalyticsProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})

  const weekMonday = useMemo(() => mondayOfWeekContaining(todayIsoLocal()), [])
  const prevMonday = useMemo(() => previousWeekMonday(weekMonday), [weekMonday])
  const weekEnd = useMemo(() => weekRangeEndSaturday(weekMonday), [weekMonday])

  const currentWeek = useMemo(
    () => buildWeekDispatchSeries(counts, weekMonday),
    [counts, weekMonday],
  )
  const previousWeek = useMemo(
    () => buildWeekDispatchSeries(counts, prevMonday),
    [counts, prevMonday],
  )

  const previousWeekTotal = useMemo(() => sumDispatchSeries(previousWeek), [previousWeek])

  const analytics = useMemo(
    () => computeDispatchAnalytics(currentWeek, previousWeekTotal),
    [currentWeek, previousWeekTotal],
  )

  const insightLines = useMemo(
    () => buildDispatchInsightLines(analytics, analytics.criticalDay),
    [analytics],
  )

  const weeklyComparisonLabel = useMemo(() => {
    if (analytics.weeklyComparison === null) return '—'
    const n = analytics.weeklyComparison
    return n > 0 ? `+${n}` : String(n)
  }, [analytics.weeklyComparison])

  const loadWeeks = useCallback(async () => {
    if (!configured) {
      setCounts({})
      return
    }
    setLoading(true)
    setError(null)
    try {
      const map = await fetchHubDispatchedCountsForRange(prevMonday, weekEnd)
      setCounts(map)
    } catch (err: unknown) {
      setError(formatSupabaseOrError(err))
      setCounts({})
    } finally {
      setLoading(false)
    }
  }, [configured, prevMonday, weekEnd])

  useEffect(() => {
    void loadWeeks()
  }, [loadWeeks])

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
  const criticalDayPercentage = analytics.criticalDay?.percentage ?? 0

  return (
    <div className="nm-hub-app nm-hub-app--dispatch-analytics admin-stats-container">
      <header className="dashboard-navbar dashboard-navbar-clean nm-hub-header">
        <HubBrandBar
          integratedDashboard
          adminSignOut={adminSignOut}
          integratedSubtitle="Analítica de despachos"
          integratedSubtitleTone="muted"
        />
      </header>

      <header className="stats-header">
        <h2>Panel de Control Admin</h2>
        <span>Métricas de Rendimiento y Despachos</span>
        <p className="stats-header__range nm-hub-muted">
          Semana {weekMonday} — {weekEnd}
          {loading ? ' · cargando…' : null}
        </p>
      </header>

      {error ? (
        <p className="nm-hub-error" role="alert">
          {error}
        </p>
      ) : null}

      {!configured ? (
        <p className="nm-hub-muted">
          Configurá Supabase en <code>.env</code> para ver analítica de despachos.
        </p>
      ) : null}

      <section className="kpi-grid" aria-label="Indicadores clave">
        <div className="kpi-card-metric">
          <label>Promedio Diario</label>
          <span className="metric-value">{formatMetric(analytics.dailyAverage)}</span>
        </div>
        <div className="kpi-card-metric">
          <label>Récord de Despacho</label>
          <span className="metric-value">{analytics.historicMax}</span>
        </div>
        <div className="kpi-card-metric-alert">
          <label>Punto Crítico ({criticalDayName})</label>
          <span className="metric-value">
            {analytics.criticalDay ? `-${criticalDayPercentage}%` : '—'}
          </span>
        </div>
      </section>

      <section className="chart-main-holder" aria-label="Despachos por día">
        <DispatchBarChart series={currentWeek} dailyAverage={analytics.dailyAverage} />
      </section>

      <section className="admin-insights-log" aria-label="Insights de producción">
        <span className="insight-section-title">Insights de Producción</span>

        <div className="insight-row">
          <p className="insight-text">
            <strong>[DATA_BOT]:</strong> La estabilidad de flujo es del {analytics.stabilityIndex}%.
            {analytics.stabilityIndex < 70
              ? ' Se sugiere revisar acumulación de stock.'
              : ' Flujo de trabajo constante.'}
          </p>
        </div>

        <div className="insight-row">
          <p className="insight-text">
            <strong>[DATA_BOT]:</strong> Rendimiento semanal: {weeklyComparisonLabel}%
            {analytics.weeklyComparison !== null
              ? ' en comparación a la semana anterior.'
              : ' (sin base de semana anterior).'}
          </p>
        </div>

        {insightLines.map((line) => (
          <div key={line} className="insight-row">
            <p className="insight-text">
              <strong>[DATA_BOT]:</strong> {line}
            </p>
          </div>
        ))}
      </section>

      <p className="nm-hub-muted stats-footer-note">
        <a
          href="/pedidos-despachados"
          className="nm-hub-back"
          onClick={(e) => {
            e.preventDefault()
            hubNavigate('/pedidos-despachados')
          }}
        >
          ← Calendario de despachos
        </a>
        <span aria-hidden="true"> · </span>
        <a
          href="/pedidos-despachados/cargar"
          className="nm-hub-back"
          onClick={(e) => {
            e.preventDefault()
            hubNavigate('/pedidos-despachados/cargar')
          }}
        >
          Cargar conteos
        </a>
      </p>
    </div>
  )
}
