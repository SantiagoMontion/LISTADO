import { useCallback, useEffect, useState } from 'react'
import { HubBrandBar } from './HubBrandBar'
import { HUB_NAV_EVENT, hubNavigate } from '../lib/hubNavigate'
import { addDaysToIsoDate, formatDayMonthShort, normalizeCalendarDate, todayIsoLocal } from '../lib/date'
import { formatSupabaseOrError } from '../lib/errors'
import {
  fetchHubDispatchedCount,
  incrementHubDispatchedCount,
} from '../lib/hubDispatchedOrdersApi'

function normalizePathname(): string {
  let p = (window.location.pathname || '/').toLowerCase()
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}

function readDayFromUrl(): string {
  if (typeof window === 'undefined') return ''
  const d = normalizeCalendarDate(new URLSearchParams(window.location.search).get('d'))
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ''
}

interface HubDispatchedOrdersAppProps {
  configured: boolean
  isAdmin: boolean
  adminSignOut?: boolean
}

export function HubDispatchedOrdersApp({
  configured,
  isAdmin,
  adminSignOut = false,
}: HubDispatchedOrdersAppProps) {
  const [day, setDay] = useState(() =>
    typeof window !== 'undefined' ? readDayFromUrl() || todayIsoLocal() : todayIsoLocal(),
  )
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyDay = useCallback((next: string) => {
    const d = normalizeCalendarDate(next)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return
    setDay(d)
    const u = new URL(window.location.href)
    u.pathname = '/pedidos-despachados'
    u.searchParams.set('d', d)
    window.history.replaceState(null, '', `${u.pathname}${u.search}`)
    window.dispatchEvent(new CustomEvent(HUB_NAV_EVENT))
  }, [])

  const loadCount = useCallback(async (forDay: string, silent = false) => {
    if (!configured) {
      setCount(0)
      return
    }
    if (!silent) setLoading(true)
    setError(null)
    try {
      const n = await fetchHubDispatchedCount(forDay)
      setCount(n)
    } catch (err: unknown) {
      setError(formatSupabaseOrError(err))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [configured])

  useEffect(() => {
    const sync = () => {
      if (normalizePathname() !== '/pedidos-despachados') return
      const d = readDayFromUrl() || todayIsoLocal()
      setDay((prev) => (prev === d ? prev : d))
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
    const raw = u.searchParams.get('d')
    const d = normalizeCalendarDate(raw)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      u.searchParams.set('d', day)
      window.history.replaceState(null, '', `${u.pathname}${u.search}`)
    }
  }, [day])

  useEffect(() => {
    void loadCount(day)
  }, [day, loadCount])

  const onIncrement = async () => {
    if (!isAdmin || !configured || busy) return
    setBusy(true)
    setError(null)
    try {
      const next = await incrementHubDispatchedCount(day)
      setCount(next)
    } catch (err: unknown) {
      setError(formatSupabaseOrError(err))
      await loadCount(day, true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="nm-hub-app nm-hub-app--dispatched-orders">
      <header className="dashboard-navbar dashboard-navbar-clean nm-hub-header">
        <HubBrandBar
          integratedDashboard
          adminSignOut={adminSignOut}
          integratedSubtitle="Pedidos despachados"
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
        <p className="nm-hub-error nm-hub-dispatched-feedback" role="alert">
          {error}
        </p>
      ) : null}

      {!configured ? (
        <p className="nm-hub-muted nm-hub-dispatched-feedback">
          Configurá Supabase en <code>.env</code> para usar pedidos despachados.
        </p>
      ) : null}

      <section className="date-pager-faja-compacta" aria-label="Día de pedidos despachados">
        <div className="date-pager-compact-side date-pager-compact-side--start">
          <button
            type="button"
            className="pager-tactic-btn"
            onClick={() => applyDay(addDaysToIsoDate(day, -1))}
            disabled={!configured || loading || busy}
            aria-label="Día anterior"
          >
            ←
          </button>
        </div>
        <div className="date-pager-panel-compact nm-hub-date-picker">
          <span className="date-text-accent-number">{formatDayMonthShort(day)}</span>
          <input
            type="date"
            className="nm-hub-input nm-hub-date-native nm-hub-printed-date-native"
            value={day}
            disabled={!configured || loading || busy}
            onChange={(e) => applyDay(normalizeCalendarDate(e.target.value))}
            aria-label="Elegir día"
          />
        </div>
        <div className="date-pager-compact-side date-pager-compact-side--end">
          <button
            type="button"
            className="pager-tactic-btn"
            onClick={() => applyDay(addDaysToIsoDate(day, 1))}
            disabled={!configured || loading || busy}
            aria-label="Día siguiente"
          >
            →
          </button>
        </div>
      </section>

      <section className="hub-dispatched-hero" aria-labelledby="hub-dispatched-hero-label">
        <p id="hub-dispatched-hero-label" className="hub-dispatched-hero__label">
          Pedidos despachados
        </p>
        <p
          className="hub-dispatched-hero__count"
          aria-live="polite"
          aria-busy={loading || busy}
        >
          {loading && configured ? '…' : count}
        </p>
        {isAdmin && configured ? (
          <div className="hub-dispatched-hero__actions">
            <button
              type="button"
              className="hub-dispatched-add-btn navbar-trailing-action-btn"
              onClick={() => void onIncrement()}
              disabled={busy || loading}
              aria-label="Sumar un pedido despachado para este día"
              title="Sumar pedido despachado"
            >
              +
            </button>
            <p className="hub-dispatched-hero__hint">Solo administración puede sumar</p>
          </div>
        ) : null}
      </section>
    </div>
  )
}
