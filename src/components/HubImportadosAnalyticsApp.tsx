import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { HubBrandBar } from './HubBrandBar'
import { HubDesktopNav } from './HubDesktopNav'
import { HubPeriodNavButton } from './HubPeriodNavButton'
import { todayIsoLocal } from '../lib/date'
import { formatSupabaseOrError } from '../lib/errors'
import {
  buildImportadosInsightLines,
  computeImportadosAnalytics,
  formatCompactArs,
  formatWeekRangeDisplay,
  mondayOfWeekContaining,
  nextWeekMonday,
  previousWeekMonday,
  weekRangeEndFriday,
  type ImportadosDayRecord,
} from '../lib/importadosAnalytics'
import { fetchImportadosSales } from '../lib/importadosOrdersApi'
import type { ImportadosSaleLine } from '../lib/importadosSalesSummary'
import type { HubUserRole } from '../lib/types'

const NOT_BOT_TAG = '[NOT-BOT]'

interface HubImportadosAnalyticsAppProps {
  configured: boolean
  role: HubUserRole | null | undefined
  adminSignOut?: boolean
}

function formatMetric(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function ImportadosBarChart({
  series,
  dailyAverage,
}: {
  series: ImportadosDayRecord[]
  dailyAverage: number
}) {
  const chartMax = useMemo(() => {
    const peak = Math.max(dailyAverage, ...series.map((row) => row.unidades), 1)
    return Math.ceil(peak * 1.1)
  }, [series, dailyAverage])

  const referenceBottomPct = (dailyAverage / chartMax) * 100

  return (
    <div
      className="dispatch-bar-chart"
      role="img"
      aria-label="Unidades de importados vendidas de lunes a viernes"
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
            const heightPct = (row.unidades / chartMax) * 100
            const aboveAverage = row.unidades >= dailyAverage
            return (
              <div key={row.fecha} className="dispatch-bar-chart__column">
                <div className="dispatch-bar-chart__bar-wrap">
                  <div
                    className={`dispatch-bar-chart__bar${aboveAverage ? ' dispatch-bar-chart__bar--above' : ' dispatch-bar-chart__bar--below'}`}
                    style={{ height: `${heightPct}%` }}
                    title={`${row.dia}: ${row.unidades}`}
                  />
                </div>
                <span className="dispatch-bar-chart__value">{row.unidades}</span>
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

export function HubImportadosAnalyticsApp({
  configured,
  role,
  adminSignOut = false,
}: HubImportadosAnalyticsAppProps) {
  const currentWeekMonday = useMemo(() => mondayOfWeekContaining(todayIsoLocal()), [])
  const [selectedWeekMonday, setSelectedWeekMonday] = useState(currentWeekMonday)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lines, setLines] = useState<ImportadosSaleLine[]>([])
  const [tableMissing, setTableMissing] = useState(false)

  const weekEnd = useMemo(() => weekRangeEndFriday(selectedWeekMonday), [selectedWeekMonday])
  const prevMonday = useMemo(() => previousWeekMonday(selectedWeekMonday), [selectedWeekMonday])
  const weekRangeLabel = useMemo(
    () => formatWeekRangeDisplay(selectedWeekMonday, weekEnd),
    [selectedWeekMonday, weekEnd],
  )
  const canGoForward = selectedWeekMonday < currentWeekMonday

  const { series, analytics } = useMemo(
    () => computeImportadosAnalytics(lines, selectedWeekMonday, prevMonday),
    [lines, selectedWeekMonday, prevMonday],
  )

  const insightLines = useMemo(() => buildImportadosInsightLines(analytics), [analytics])

  const shiftWeek = useCallback((direction: -1 | 1) => {
    setSelectedWeekMonday((prev) =>
      direction < 0 ? previousWeekMonday(prev) : nextWeekMonday(prev),
    )
  }, [])

  const loadData = useCallback(async () => {
    if (!configured) {
      setLines([])
      setTableMissing(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const sales = await fetchImportadosSales()
      setTableMissing(sales.tableMissing)
      setLines(sales.lines)
      if (sales.ingestError) setError(sales.ingestError)
    } catch (err: unknown) {
      setError(formatSupabaseOrError(err))
      setLines([])
    } finally {
      setLoading(false)
    }
  }, [configured])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const criticalDayName = analytics.criticalDay?.name ?? '—'
  const criticalPct = analytics.criticalDay?.percentage ?? 0

  return (
    <div className="nm-hub-app nm-hub-app--dispatch-analytics">
      <header className="dashboard-navbar dashboard-navbar-clean nm-hub-header">
        <HubBrandBar
          integratedDashboard
          adminSignOut={adminSignOut}
          integratedSubtitle="Analíticas de importados"
          integratedSubtitleTone="muted"
        />
      </header>

      <HubDesktopNav role={role} />

      <div className="admin-analytics-holder">
        <header className="admin-analytics-holder__head">
          <h1 className="admin-analytics-holder__title">Analíticas de importados</h1>
          <p className="admin-analytics-holder__lead">
            Ventas pagadas en Shopify, costo unitario y ganancia semanal.
          </p>
        </header>

        <section className="week-pager-rebel" aria-label="Semana de consulta">
          <HubPeriodNavButton
            direction="prev"
            onClick={() => shiftWeek(-1)}
            disabled={!configured || loading}
            aria-label="Semana anterior"
          />
          <span className="week-range-text" aria-live="polite">
            {weekRangeLabel}
            {loading ? ' …' : null}
          </span>
          <HubPeriodNavButton
            direction="next"
            onClick={() => shiftWeek(1)}
            disabled={!configured || loading || !canGoForward}
            aria-label="Semana siguiente"
          />
        </section>

        {error ? (
          <p className="nm-hub-error admin-analytics-holder__feedback" role="alert">
            {error}
          </p>
        ) : null}

        {!configured ? (
          <p className="nm-hub-muted admin-analytics-holder__feedback">
            Configurá Supabase en <code>.env</code> para ver analítica de importados.
          </p>
        ) : null}

        {tableMissing ? (
          <p className="nm-hub-muted admin-analytics-holder__feedback">
            Falta aplicar la tabla <code>importados_sales</code> para anotar ganancias.
          </p>
        ) : null}

        <section className="kpi-analytics-grid" aria-label="Indicadores de importados">
          <article className="kpi-card-rebel">
            <span className="kpi-card-label">Ganancia</span>
            <span className="kpi-card-number">{formatCompactArs(analytics.weeklyProfitArs)}</span>
            <span className="kpi-card-subtext">ARS de la semana</span>
          </article>
          <article className="kpi-card-rebel">
            <span className="kpi-card-label">Unidades</span>
            <span className="kpi-card-number">{analytics.weeklyUnits}</span>
            <span className="kpi-card-subtext">
              {analytics.dailyAverage > 0
                ? `prom. ${formatMetric(analytics.dailyAverage)} / día L-V`
                : 'vendidas en la semana'}
            </span>
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

        <section className="chart-card-wrapper" aria-label="Unidades por día">
          <h3 className="chart-card-wrapper__title">Unidades vendidas por día</h3>
          <ImportadosBarChart series={series} dailyAverage={analytics.dailyAverage} />
        </section>

        <section className="insights-log-box" aria-label="Lectura de importados">
          <h3 className="insights-log-box__title">Lectura de la semana</h3>

          {insightLines.length === 0 ? (
            <InsightRow>
              Todavía no hay ventas de importados en esta semana. El tab lee pedidos pagados de
              Shopify.
            </InsightRow>
          ) : (
            insightLines.map((line) => <InsightRow key={line}>{line}</InsightRow>)
          )}
        </section>
      </div>
    </div>
  )
}
