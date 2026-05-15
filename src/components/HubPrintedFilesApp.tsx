import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react'
import { HubBrandBar } from './HubBrandBar'
import { HUB_NAV_EVENT, onHubLinkClick } from '../lib/hubNavigate'
import { addDaysToIsoDate, formatDayMonthShort, normalizeCalendarDate, todayIsoLocal } from '../lib/date'
import { formatSupabaseOrError } from '../lib/errors'
import {
  NM_PROD_MATERIAL_FAMILIES,
  NM_PROD_MATERIAL_FAMILY_LABEL,
  fetchMaterialImagesByFecha,
  signedMaterialImageUrl,
} from '../lib/nmProdMaterialImages'
import type { NmProdMaterialFamily, NmProdMaterialImageRow } from '../lib/types'

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

interface HubPrintedFilesAppProps {
  configured: boolean
}

export function HubPrintedFilesApp({ configured }: HubPrintedFilesAppProps) {
  const [day, setDay] = useState(() =>
    typeof window !== 'undefined' ? readDayFromUrl() || todayIsoLocal() : todayIsoLocal(),
  )
  const [rows, setRows] = useState<NmProdMaterialImageRow[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeFamily, setActiveFamily] = useState<NmProdMaterialFamily>('classic')
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const filteredLenRef = useRef(0)

  const applyDay = useCallback((next: string) => {
    const d = normalizeCalendarDate(next)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return
    setDay(d)
    const u = new URL(window.location.href)
    u.pathname = '/archivos-impresos'
    u.searchParams.set('d', d)
    window.history.replaceState(null, '', `${u.pathname}${u.search}`)
    window.dispatchEvent(new CustomEvent(HUB_NAV_EVENT))
  }, [])

  useEffect(() => {
    const sync = () => {
      if (normalizePathname() !== '/archivos-impresos') return
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
    if (!configured) {
      setRows([])
      setUrls({})
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setRows([])
    setUrls({})
    fetchMaterialImagesByFecha(day)
      .then(async (list) => {
        if (cancelled) return
        setRows(list)
        const next: Record<string, string> = {}
        for (const r of list) {
          const u = await signedMaterialImageUrl(r.storage_path)
          if (cancelled) return
          if (u) next[r.id] = u
        }
        if (!cancelled) setUrls(next)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setRows([])
          setUrls({})
          setError(formatSupabaseOrError(e))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [configured, day])

  const counts = useMemo(() => {
    const c: Record<NmProdMaterialFamily, number> = { classic: 0, pro: 0, ultra: 0, alfombra: 0, faltas: 0 }
    for (const r of rows) c[r.material_family] += 1
    return c
  }, [rows])

  const availableFamilies = useMemo(
    () => NM_PROD_MATERIAL_FAMILIES.filter((f) => counts[f] > 0),
    [counts],
  )

  useEffect(() => {
    if (loading) return
    const avail = NM_PROD_MATERIAL_FAMILIES.filter((f) => counts[f] > 0)
    if (avail.length === 0) return
    setActiveFamily(avail.includes('classic') ? 'classic' : avail[0])
  }, [day, loading, counts])

  const filteredRows = useMemo(
    () => rows.filter((r) => r.material_family === activeFamily),
    [rows, activeFamily],
  )

  const viewableRows = useMemo(() => filteredRows.filter((r) => Boolean(urls[r.id])), [filteredRows, urls])

  filteredLenRef.current = viewableRows.length

  useEffect(() => {
    setLightboxIndex(null)
  }, [day, activeFamily])

  useEffect(() => {
    if (lightboxIndex === null) return
    if (viewableRows.length === 0) {
      setLightboxIndex(null)
      return
    }
    if (lightboxIndex >= viewableRows.length) {
      setLightboxIndex(viewableRows.length - 1)
    }
  }, [lightboxIndex, viewableRows.length])

  useEffect(() => {
    if (lightboxIndex === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxIndex(null)
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setLightboxIndex((i) =>
          i !== null && i < filteredLenRef.current - 1 ? i + 1 : i,
        )
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setLightboxIndex((i) => (i !== null && i > 0 ? i - 1 : i))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxIndex])

  const goLightboxNext = useCallback(() => {
    setLightboxIndex((i) =>
      i !== null && i < filteredLenRef.current - 1 ? i + 1 : i,
    )
  }, [])

  const goLightboxPrev = useCallback(() => {
    setLightboxIndex((i) => (i !== null && i > 0 ? i - 1 : i))
  }, [])

  const onLightboxTouchStart = useCallback((e: TouchEvent) => {
    const t = e.touches[0]
    touchStartRef.current = { x: t.clientX, y: t.clientY }
  }, [])

  const onLightboxTouchEnd = useCallback((e: TouchEvent) => {
    const start = touchStartRef.current
    touchStartRef.current = null
    if (!start) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) < Math.abs(dy) * 1.15) return
    const threshold = 48
    if (dx < -threshold) goLightboxNext()
    else if (dx > threshold) goLightboxPrev()
  }, [goLightboxNext, goLightboxPrev])

  return (
    <div className="nm-hub-app">
      <header className="nm-hub-header">
        <HubBrandBar context="Impresos" />
      </header>

      <p className="nm-hub-footnote" style={{ marginBottom: '0.5rem' }}>
        <a href="/" className="nm-hub-back" onClick={(e) => onHubLinkClick(e, '/')}>
          ← Inicio
        </a>
      </p>

      {error ? (
        <p className="nm-hub-error" role="alert">
          {error}
        </p>
      ) : null}

      {!configured ? (
        <p className="nm-hub-muted">Configurá Supabase en <code>.env</code> para ver archivos.</p>
      ) : null}

      <section className="nm-hub-date-strip" aria-label="Día de los archivos">
        <div className="nm-hub-date-nav">
          <div className="nm-hub-date-nav-prev-wrap">
            <button
              type="button"
              className="nm-hub-btn nm-hub-btn-ghost"
              onClick={() => applyDay(addDaysToIsoDate(day, -1))}
              disabled={!configured}
              aria-label="Día anterior"
            >
              ←
            </button>
          </div>
          <div className="nm-hub-date-picker">
            <span className="nm-hub-date-display">{formatDayMonthShort(day)}</span>
            <input
              type="date"
              className="nm-hub-input nm-hub-date-native"
              value={day}
              disabled={!configured}
              onChange={(e) => applyDay(normalizeCalendarDate(e.target.value))}
              aria-label="Elegir día"
            />
          </div>
          <button
            type="button"
            className="nm-hub-btn nm-hub-btn-ghost"
            onClick={() => applyDay(addDaysToIsoDate(day, 1))}
            disabled={!configured}
            aria-label="Día siguiente"
          >
            →
          </button>
        </div>
      </section>

      {configured && !loading && rows.length === 0 && !error ? (
        <p className="nm-hub-muted" style={{ marginTop: '1rem' }}>
          No hay imágenes cargadas para este día.
        </p>
      ) : null}

      {configured && loading ? (
        <div className="nm-hub-printed-loading" role="status" aria-live="polite">
          <div className="nm-hub-spinner" aria-hidden="true" />
          <p className="nm-hub-loading-label">Cargando imágenes…</p>
        </div>
      ) : null}

      {availableFamilies.length > 0 && !loading ? (
        <div className="nm-hub-subtabs nm-hub-printed-filters" role="tablist" aria-label="Filtrar por material">
          {availableFamilies.map((fam) => {
            const n = counts[fam]
            const isActive = fam === activeFamily
            return (
              <button
                key={fam}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`nm-hub-subtab${isActive ? ' nm-hub-subtab--active' : ''}`}
                onClick={() => setActiveFamily(fam)}
              >
                {NM_PROD_MATERIAL_FAMILY_LABEL[fam]} ({n})
              </button>
            )
          })}
        </div>
      ) : null}

      {configured && !loading && viewableRows.length === 0 && rows.length > 0 ? (
        <p className="nm-hub-muted" style={{ marginTop: '0.75rem' }}>
          No hay imágenes en esta categoría para el día.
        </p>
      ) : null}

      {!loading ? (
        <ul className="nm-hub-printed-list" aria-label="Imágenes">
          {viewableRows.map((r, idx) => {
            const src = urls[r.id] as string
            return (
              <li key={r.id} className="nm-hub-printed-item">
                <button
                  type="button"
                  className="nm-hub-printed-thumb-btn"
                  onClick={() => setLightboxIndex(idx)}
                  aria-label={`Ampliar imagen ${NM_PROD_MATERIAL_FAMILY_LABEL[r.material_family]}`}
                >
                  <img src={src} alt="" className="nm-hub-printed-thumb-img" decoding="async" />
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}

      {lightboxIndex !== null && viewableRows[lightboxIndex] ? (
        <div
          className="nm-hub-printed-lightbox-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setLightboxIndex(null)
          }}
        >
          <div className="nm-hub-printed-lightbox" role="dialog" aria-modal="true" aria-label="Vista ampliada">
            <div className="nm-hub-printed-lightbox-top">
              <button type="button" className="nm-hub-btn nm-hub-printed-lightbox-close" onClick={() => setLightboxIndex(null)}>
                Cerrar
              </button>
            </div>
            {viewableRows.length > 1 ? (
              <p className="nm-hub-printed-lightbox-counter" aria-live="polite">
                {lightboxIndex + 1} / {viewableRows.length}
              </p>
            ) : null}
            <div
              className="nm-hub-printed-lightbox-swipe"
              onTouchStart={onLightboxTouchStart}
              onTouchEnd={onLightboxTouchEnd}
            >
              {viewableRows.length > 1 ? (
                <>
                  <button
                    type="button"
                    className="nm-hub-printed-lightbox-nav nm-hub-printed-lightbox-nav--prev"
                    aria-label="Imagen anterior"
                    disabled={lightboxIndex <= 0}
                    onClick={goLightboxPrev}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="nm-hub-printed-lightbox-nav nm-hub-printed-lightbox-nav--next"
                    aria-label="Imagen siguiente"
                    disabled={lightboxIndex >= viewableRows.length - 1}
                    onClick={goLightboxNext}
                  >
                    ›
                  </button>
                </>
              ) : null}
              <img
                src={urls[viewableRows[lightboxIndex].id] ?? ''}
                alt=""
                className="nm-hub-printed-lightbox-img"
                draggable={false}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
