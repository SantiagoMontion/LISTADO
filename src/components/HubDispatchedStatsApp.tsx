import { useCallback, useEffect, useMemo, useState } from 'react'
import { HubBrandBar } from './HubBrandBar'
import { HUB_NAV_EVENT, hubNavigate, onHubLinkClick } from '../lib/hubNavigate'
import {
  addMonthsToYearMonth,
  buildMonthCalendarGrid,
  currentYearMonthLocal,
  formatMonthYearLabel,
  parseYearMonth,
  todayIsoLocal,
} from '../lib/date'
import { formatSupabaseOrError } from '../lib/errors'
import {
  fetchHubDispatchedCountsForMonth,
  sumHubDispatchedCounts,
} from '../lib/hubDispatchedOrdersApi'

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const

function normalizePathname(): string {
  let p = (window.location.pathname || '/').toLowerCase()
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}

function readMonthFromUrl(): string {
  if (typeof window === 'undefined') return ''
  const m = (new URLSearchParams(window.location.search).get('m') ?? '').trim()
  return parseYearMonth(m) ? m : ''
}

interface HubDispatchedStatsAppProps {
  configured: boolean
  adminSignOut?: boolean
}

export function HubDispatchedStatsApp({
  configured,
  adminSignOut = false,
}: HubDispatchedStatsAppProps) {
  const [yearMonth, setYearMonth] = useState(() =>
    typeof window !== 'undefined' ? readMonthFromUrl() || currentYearMonthLocal() : currentYearMonthLocal(),
  )
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsed = parseYearMonth(yearMonth)
  const grid = useMemo(
    () => (parsed ? buildMonthCalendarGrid(parsed.year, parsed.month) : []),
    [parsed?.year, parsed?.month],
  )
  const monthTotal = useMemo(() => sumHubDispatchedCounts(counts), [counts])
  const today = todayIsoLocal()

  const applyMonth = useCallback((next: string) => {
    if (!parseYearMonth(next)) return
    setYearMonth(next)
    const u = new URL(window.location.href)
    u.pathname = '/pedidos-despachados/estadisticas'
    u.searchParams.set('m', next)
    window.history.replaceState(null, '', `${u.pathname}${u.search}`)
    window.dispatchEvent(new CustomEvent(HUB_NAV_EVENT))
  }, [])

  const loadMonth = useCallback(
    async (ym: string) => {
      if (!configured) {
        setCounts({})
        return
      }
      setLoading(true)
      setError(null)
      try {
        const map = await fetchHubDispatchedCountsForMonth(ym)
        setCounts(map)
      } catch (err: unknown) {
        setError(formatSupabaseOrError(err))
        setCounts({})
      } finally {
        setLoading(false)
      }
    },
    [configured],
  )

  useEffect(() => {
    const sync = () => {
      if (normalizePathname() !== '/pedidos-despachados/estadisticas') return
      const m = readMonthFromUrl() || currentYearMonthLocal()
      setYearMonth((prev) => (prev === m ? prev : m))
    }
    window.addEventListener('popstate', sync)
    window.addEventListener(HUB_NAV_EVENT, sync as EventListener)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener(HUB_NAV_EVENT, sync as EventListener)
    }
  }, [])

  useEffect(() => {
    const u = new URL(window.location.href)
    if (!parseYearMonth(u.searchParams.get('m') ?? '')) {
      u.searchParams.set('m', yearMonth)
      window.history.replaceState(null, '', `${u.pathname}${u.search}`)
    }
  }, [yearMonth])

  useEffect(() => {
    void loadMonth(yearMonth)
  }, [yearMonth, loadMonth])

  return (
    <div className="nm-hub-app nm-hub-app--dispatched-stats">
      <header className="dashboard-navbar dashboard-navbar-clean nm-hub-header">
        <HubBrandBar
          integratedDashboard
          adminSignOut={adminSignOut}
          integratedSubtitle="Estadísticas despachos"
          integratedSubtitleTone="muted"
          trailing={
            <button
              type="button"
              className="nm-hub-brand-bar__btn navbar-global-menu-btn"
              aria-label="Panel principal"
              title="Panel principal"
              onClick={() => hubNavigate('/')}
            >
              ☰
            </button>
          }
        />
      </header>

      {error ? (
        <p className="nm-hub-error hub-dispatched-stats-feedback" role="alert">
          {error}
        </p>
      ) : null}

      {!configured ? (
        <p className="nm-hub-muted hub-dispatched-stats-feedback">
          Configurá Supabase en <code>.env</code> para ver estadísticas.
        </p>
      ) : null}

      <section className="hub-dispatched-stats-month-bar" aria-label="Mes">
        <button
          type="button"
          className="pager-tactic-btn"
          onClick={() => applyMonth(addMonthsToYearMonth(yearMonth, -1))}
          disabled={!configured || loading}
          aria-label="Mes anterior"
        >
          ←
        </button>
        <h2 className="hub-dispatched-stats-month-title">{formatMonthYearLabel(yearMonth)}</h2>
        <button
          type="button"
          className="pager-tactic-btn"
          onClick={() => applyMonth(addMonthsToYearMonth(yearMonth, 1))}
          disabled={!configured || loading}
          aria-label="Mes siguiente"
        >
          →
        </button>
      </section>

      <div className="hub-dispatched-stats-total" aria-live="polite">
        <span className="hub-dispatched-stats-total__label">Total del mes</span>
        <span className="hub-dispatched-stats-total__value">
          {loading && configured ? '…' : monthTotal}
        </span>
      </div>

      <p className="hub-dispatched-stats-nav">
        <a
          href="/pedidos-despachados"
          className="nm-hub-back"
          onClick={(e) => onHubLinkClick(e, '/pedidos-despachados')}
        >
          ← Registrar pedidos
        </a>
      </p>

      <div className="hub-dispatched-stats-calendar" aria-busy={loading}>
        <div className="hub-dispatched-stats-weekdays" aria-hidden="true">
          {WEEKDAY_LABELS.map((label) => (
            <span key={label} className="hub-dispatched-stats-weekday">
              {label}
            </span>
          ))}
        </div>

        <div className="hub-dispatched-stats-grid" role="grid" aria-label={`Calendario ${formatMonthYearLabel(yearMonth)}`}>
          {grid.map((cell, idx) => {
            if (!cell.iso) {
              return <div key={`empty-${idx}`} className="hub-dispatched-stats-cell hub-dispatched-stats-cell--empty" />
            }
            const n = counts[cell.iso] ?? 0
            const isToday = cell.iso === today
            const hasData = n > 0
            return (
              <a
                key={cell.iso}
                href={`/pedidos-despachados?d=${cell.iso}`}
                className={`hub-dispatched-stats-cell${isToday ? ' hub-dispatched-stats-cell--today' : ''}${hasData ? ' hub-dispatched-stats-cell--has-data' : ''}`}
                role="gridcell"
                onClick={(e) => onHubLinkClick(e, `/pedidos-despachados?d=${cell.iso}`)}
                aria-label={`${cell.day} de ${formatMonthYearLabel(yearMonth)}: ${n} despachados`}
              >
                <span className="hub-dispatched-stats-cell__day">{cell.day}</span>
                <span className="hub-dispatched-stats-cell__count">{n}</span>
              </a>
            )
          })}
        </div>
      </div>
    </div>
  )
}
