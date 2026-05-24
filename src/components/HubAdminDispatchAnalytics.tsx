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
  weekRangeEndFriday,
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
      aria-label="Gráfico de barras de despachos de lunes a viernes con línea de promedio diario"
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
            const heightPct = (row.despachados / chartMax) * 100
            const aboveAverage = row.despachados >= dailyAverage
            return (
              <div key={row.fecha} className="dispatch-bar-chart__column">
                <div className="dispatch-bar-chart__bar-wrap">
                  <div
                    className={`dispatch-bar-chart__bar${aboveAverage ? ' dispatch-bar-chart__bar--above' : ' dispatch-bar-chart__bar--below'}`}
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
  const weekEnd = useMemo(() => weekRangeEndFriday(weekMonday), [weekMonday])

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
    <div className="nm-hub-app nm-hub-app--dispatch-analytics">
      <header className="dashboard-navbar dashboard-navbar-clean nm-hub-header">
        <HubBrandBar
          integratedDashboard
          adminSignOut={adminSignOut}
          integratedSubtitle="Analítica de despachos"
          integratedSubtitleTone="muted"
        />
      </header>

      <div className="admin-analytics-holder">
        <header className="analytics-header">
          <h2>Panel de Control Admin</h2>
          <span>Métricas de rendimiento y despachos (lun–vie)</span>
          <p className="analytics-header__range">
            Semana {weekMonday} — {weekEnd}
            {loading ? ' · cargando…' : null}
          </p>
        </header>

        {error ? (
          <p className="nm-hub-error admin-analytics-holder__feedback" role="alert">
            {error}
          </p>
        ) : null}

        {!configured ? (
          <p className="nm-hub-muted admin-analytics-holder__feedback">
            Configurá Supabase en <code>.env</code> para ver analítica de despachos.
          </p>
        ) : null}

        <section className="kpi-analytics-grid" aria-label="Indicadores clave">
          <article className="kpi-card-rebel">
            <span className="kpi-card-label">Promedio diario</span>
            <span className="kpi-card-number">{formatMetric(analytics.dailyAverage)}</span>
            <span className="kpi-card-subtext">pedidos / día hábil</span>
          </article>
          <article className="kpi-card-rebel">
            <span className="kpi-card-label">Récord</span>
            <span className="kpi-card-number">{analytics.historicMax}</span>
            <span className="kpi-card-subtext">techo semanal</span>
          </article>
          <article
            className={`kpi-card-rebel${analytics.criticalDay ? ' alert-critical' : ''}`}
          >
            <span className="kpi-card-label">Punto crítico</span>
            <span className="kpi-card-number">
              {analytics.criticalDay ? `-${criticalDayPercentage}%` : '—'}
            </span>
            <span className="kpi-card-subtext">{criticalDayName}</span>
          </article>
        </section>

        <section className="chart-card-wrapper" aria-label="Despachos por día">
          <h3 className="chart-card-wrapper__title">Despachos por día</h3>
          <DispatchBarChart series={currentWeek} dailyAverage={analytics.dailyAverage} />
        </section>

        <section className="insights-log-box" aria-label="Insights de producción">
          <h3 className="insights-log-box__title">Insights de producción</h3>

          <div className="insight-log-row">
            <span className="insight-bot-tag">[DATA_BOT]</span>
            La estabilidad de flujo es del {analytics.stabilityIndex}%.
            {analytics.stabilityIndex < 70
              ? ' Se sugiere revisar acumulación de stock.'
              : ' Flujo de trabajo constante.'}
          </div>

          <div className="insight-log-row">
            <span className="insight-bot-tag">[DATA_BOT]</span>
            Rendimiento semanal: {weeklyComparisonLabel}%
            {analytics.weeklyComparison !== null
              ? ' en comparación a la semana anterior.'
              : ' (sin base de semana anterior).'}
          </div>

          {insightLines.map((line) => (
            <div key={line} className="insight-log-row">
              <span className="insight-bot-tag">[DATA_BOT]</span>
              {line}
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
