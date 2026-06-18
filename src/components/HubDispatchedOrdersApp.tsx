import { useCallback, useEffect, useRef, useState } from 'react'
import { HubBrandBar } from './HubBrandBar'
import { HubDesktopNav } from './HubDesktopNav'
import { HUB_NAV_EVENT, hubNavigate } from '../lib/hubNavigate'
import {
  addDaysToIsoDate,
  currentYearMonthLocal,
  formatDayMonthShort,
  normalizeCalendarDate,
  todayIsoLocal,
} from '../lib/date'
import { formatSupabaseOrError } from '../lib/errors'
import { fetchHubDispatchedCount, setHubDispatchedCount } from '../lib/hubDispatchedOrdersApi'
import type { HubUserRole } from '../lib/types'

const CARGAR_PATH = '/pedidos-despachados/cargar'

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

function parseDraftCount(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return null
  const n = Math.floor(Number(t))
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

interface HubDispatchedOrdersAppProps {
  configured: boolean
  isAdmin: boolean
  profileRole?: HubUserRole | null
  adminSignOut?: boolean
}

export function HubDispatchedOrdersApp({
  configured,
  isAdmin,
  profileRole,
  adminSignOut = false,
}: HubDispatchedOrdersAppProps) {
  const [day, setDay] = useState(() =>
    typeof window !== 'undefined' ? readDayFromUrl() || todayIsoLocal() : todayIsoLocal(),
  )
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const loadSeqRef = useRef(0)

  const applyDay = useCallback((next: string) => {
    const d = normalizeCalendarDate(next)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return
    setDay(d)
    setEditing(false)
    const u = new URL(window.location.href)
    u.pathname = CARGAR_PATH
    u.searchParams.set('d', d)
    window.history.replaceState(null, '', `${u.pathname}${u.search}`)
    window.dispatchEvent(new CustomEvent(HUB_NAV_EVENT))
  }, [])

  const loadCount = useCallback(async (forDay: string, silent = false) => {
    const seq = ++loadSeqRef.current
    if (!configured) {
      setCount(0)
      return
    }
    if (!silent) setLoading(true)
    if (!silent) setError(null)
    try {
      const n = await fetchHubDispatchedCount(forDay)
      if (seq !== loadSeqRef.current) return
      setCount(n)
    } catch (err: unknown) {
      if (seq !== loadSeqRef.current) return
      setError(formatSupabaseOrError(err))
    } finally {
      if (seq === loadSeqRef.current && !silent) setLoading(false)
    }
  }, [configured])

  useEffect(() => {
    const sync = () => {
      if (normalizePathname() !== CARGAR_PATH) return
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
    setEditing(false)
    void loadCount(day)
  }, [day, loadCount])

  useEffect(() => {
    if (!editing) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [editing])

  useEffect(() => {
    if (!isAdmin || !configured || loading) return
    setDraft(String(count))
    setEditing(true)
    setError(null)
  }, [day, configured, isAdmin, loading])

  useEffect(() => {
    if (!editing || loading) return
    setDraft(String(count))
  }, [count, editing, loading])

  const closeEditor = () => {
    hubNavigate(`/pedidos-despachados?m=${day.slice(0, 7) || currentYearMonthLocal()}`)
  }

  const onSave = async () => {
    if (!isAdmin || !configured || busy) return
    const next = parseDraftCount(draft)
    if (next === null) {
      setError('Ingresá un número entero mayor o igual a 0.')
      return
    }
    setBusy(true)
    setError(null)
    loadSeqRef.current += 1
    try {
      const saved = await setHubDispatchedCount(day, next)
      setCount(saved)
      setDraft('')
      const verified = await fetchHubDispatchedCount(day)
      setCount(verified)
      hubNavigate(`/pedidos-despachados?m=${day.slice(0, 7)}`)
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
          integratedSubtitle="Cargar pedidos"
          integratedSubtitleTone="accent"
          trailing={
            <button
              type="button"
              className="nm-hub-brand-bar__btn navbar-global-menu-btn"
              aria-label="Volver al calendario"
              title="Calendario"
              onClick={() =>
                hubNavigate(`/pedidos-despachados?m=${day.slice(0, 7) || currentYearMonthLocal()}`)
              }
            >
              ☰
            </button>
          }
        />
      </header>

      <HubDesktopNav role={profileRole} />

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

        {editing ? (
          <form
            className="hub-dispatched-edit"
            onSubmit={(e) => {
              e.preventDefault()
              void onSave()
            }}
          >
            <label className="hub-dispatched-edit__label" htmlFor="hub-dispatched-count-input">
              Total del día
            </label>
            <input
              ref={inputRef}
              id="hub-dispatched-count-input"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              className="hub-dispatched-edit__input nm-hub-input field-input"
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Cantidad final de pedidos despachados"
            />
            <div className="hub-dispatched-edit__actions">
              <button
                type="submit"
                className="hub-dispatched-edit__save nm-prod-btn nm-prod-btn-primary"
                disabled={busy}
              >
                Guardar
              </button>
              <button
                type="button"
                className="hub-dispatched-edit__cancel nm-prod-btn"
                disabled={busy}
                onClick={closeEditor}
              >
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <p
            className="hub-dispatched-hero__count"
            aria-live="polite"
            aria-busy={loading || busy}
          >
            {loading && configured ? '…' : count}
          </p>
        )}
      </section>
    </div>
  )
}
