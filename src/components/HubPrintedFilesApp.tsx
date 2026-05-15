import { useCallback, useEffect, useMemo, useState } from 'react'
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
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)

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

  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

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

      {loading ? <p className="nm-hub-muted">Cargando…</p> : null}

      {availableFamilies.length > 0 ? (
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

      {configured && !loading && filteredRows.length === 0 && rows.length > 0 ? (
        <p className="nm-hub-muted" style={{ marginTop: '0.75rem' }}>
          No hay imágenes en esta categoría para el día.
        </p>
      ) : null}

      <ul className="nm-hub-printed-list" aria-label="Imágenes">
        {filteredRows.map((r) => {
          const src = urls[r.id]
          if (!src) return null
          const alt = r.original_name ?? NM_PROD_MATERIAL_FAMILY_LABEL[r.material_family]
          return (
            <li key={r.id} className="nm-hub-printed-item">
              <button
                type="button"
                className="nm-hub-printed-thumb-btn"
                onClick={() => setLightbox({ src, alt })}
                aria-label={`Ampliar ${alt}`}
              >
                <img src={src} alt="" className="nm-hub-printed-thumb-img" decoding="async" />
              </button>
              {r.original_name ? (
                <span className="nm-hub-printed-caption" title={r.original_name}>
                  {r.original_name}
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>

      {lightbox ? (
        <div
          className="nm-hub-printed-lightbox-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setLightbox(null)
          }}
        >
          <div className="nm-hub-printed-lightbox" role="dialog" aria-modal="true" aria-label="Vista ampliada">
            <button type="button" className="nm-hub-btn nm-hub-printed-lightbox-close" onClick={() => setLightbox(null)}>
              Cerrar
            </button>
            <img src={lightbox.src} alt={lightbox.alt} className="nm-hub-printed-lightbox-img" />
          </div>
        </div>
      ) : null}
    </div>
  )
}
