import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HubBrandBar } from './HubBrandBar'
import { HubImageLightbox } from './HubImageLightbox'
import { HUB_NAV_EVENT } from '../lib/hubNavigate'
import { addDaysToIsoDate, formatDayMonthShort, normalizeCalendarDate, todayIsoLocal } from '../lib/date'
import { formatSupabaseOrError } from '../lib/errors'
import {
  NM_PROD_MATERIAL_FAMILIES,
  NM_PROD_MATERIAL_FAMILY_LABEL,
  fetchMaterialImagesByFecha,
  signedMaterialImageUrl,
  signedMaterialImageUrlsByPath,
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
  adminSignOut?: boolean
}

export function HubPrintedFilesApp({ configured, adminSignOut = false }: HubPrintedFilesAppProps) {
  const [day, setDay] = useState(() =>
    typeof window !== 'undefined' ? readDayFromUrl() || todayIsoLocal() : todayIsoLocal(),
  )
  const [rows, setRows] = useState<NmProdMaterialImageRow[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [rowsLoading, setRowsLoading] = useState(false)
  const [urlsLoading, setUrlsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeFamily, setActiveFamily] = useState<NmProdMaterialFamily>('classic')
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
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
      setRowsLoading(false)
      setUrlsLoading(false)
      return
    }
    let cancelled = false
    setRowsLoading(true)
    setUrlsLoading(false)
    setError(null)
    setRows([])
    setUrls({})

    void fetchMaterialImagesByFecha(day)
      .then(async (list) => {
        if (cancelled) return
        setRows(list)
        setRowsLoading(false)
        if (list.length === 0) return

        setUrlsLoading(true)
        try {
          const byPath = await signedMaterialImageUrlsByPath(list.map((r) => r.storage_path))
          if (cancelled) return
          const next: Record<string, string> = {}
          for (const r of list) {
            const u = byPath[r.storage_path]
            if (u) next[r.id] = u
          }
          setUrls(next)
        } catch (batchErr: unknown) {
          const next: Record<string, string> = {}
          await Promise.all(
            list.map(async (r) => {
              const u = await signedMaterialImageUrl(r.storage_path)
              if (u) next[r.id] = u
            }),
          )
          if (!cancelled) setUrls(next)
          if (!cancelled && Object.keys(next).length === 0) {
            setError(formatSupabaseOrError(batchErr))
          }
        } finally {
          if (!cancelled) setUrlsLoading(false)
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setRows([])
          setUrls({})
          setError(formatSupabaseOrError(e))
          setRowsLoading(false)
          setUrlsLoading(false)
        }
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
    if (rowsLoading) return
    const avail = NM_PROD_MATERIAL_FAMILIES.filter((f) => counts[f] > 0)
    if (avail.length === 0) return
    setActiveFamily((prev) =>
      avail.includes(prev) ? prev : avail.includes('classic') ? 'classic' : avail[0],
    )
  }, [day, rowsLoading, counts])

  const filteredRows = useMemo(
    () => rows.filter((r) => r.material_family === activeFamily),
    [rows, activeFamily],
  )

  const viewableRows = useMemo(() => filteredRows.filter((r) => Boolean(urls[r.id])), [filteredRows, urls])

  filteredLenRef.current = viewableRows.length

  const showGlobalSpinner = rowsLoading
  const showGallerySpinner = !rowsLoading && urlsLoading && rows.length > 0

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

  const goLightboxNext = useCallback(() => {
    setLightboxIndex((i) =>
      i !== null && i < filteredLenRef.current - 1 ? i + 1 : i,
    )
  }, [])

  const goLightboxPrev = useCallback(() => {
    setLightboxIndex((i) => (i !== null && i > 0 ? i - 1 : i))
  }, [])

  return (
    <div className="nm-hub-app nm-hub-app--printed-files">
      <header className="dashboard-navbar dashboard-navbar-clean nm-hub-header">
        <HubBrandBar
          integratedDashboard
          adminSignOut={adminSignOut}
          integratedSubtitle="Archivos impresos"
          integratedSubtitleTone="muted"
        />
      </header>

      {error ? (
        <p className="nm-hub-error nm-hub-printed-feedback" role="alert">
          {error}
        </p>
      ) : null}

      {!configured ? (
        <p className="nm-hub-muted nm-hub-printed-feedback">Configurá Supabase en <code>.env</code> para ver archivos.</p>
      ) : null}

      <section className="date-pager-faja-compacta" aria-label="Día de los archivos">
        <div className="date-pager-compact-side date-pager-compact-side--start">
          <button
            type="button"
            className="pager-tactic-btn"
            onClick={() => applyDay(addDaysToIsoDate(day, -1))}
            disabled={!configured || rowsLoading}
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
            disabled={!configured || rowsLoading}
            onChange={(e) => applyDay(normalizeCalendarDate(e.target.value))}
            aria-label="Elegir día"
          />
        </div>
        <div className="date-pager-compact-side date-pager-compact-side--end">
          <button
            type="button"
            className="pager-tactic-btn"
            onClick={() => applyDay(addDaysToIsoDate(day, 1))}
            disabled={!configured || rowsLoading}
            aria-label="Día siguiente"
          >
            →
          </button>
        </div>
      </section>

      {configured && (
        <div className="filter-track-rebel" role="tablist" aria-label="Tipo de diseño">
          {NM_PROD_MATERIAL_FAMILIES.map((fam) => {
            const n = counts[fam]
            const active = fam === activeFamily
            const empty = n === 0
            const showHighlight = active && !empty
            const label = NM_PROD_MATERIAL_FAMILY_LABEL[fam]
            return (
              <button
                key={fam}
                type="button"
                role="tab"
                aria-selected={active}
                aria-disabled={empty || undefined}
                disabled={rowsLoading || empty}
                className={`filter-tab-item${showHighlight ? ' active-pending' : ''}`}
                onClick={() => setActiveFamily(fam)}
              >
                {label} ({n})
              </button>
            )
          })}
        </div>
      )}

      {configured && !rowsLoading && rows.length === 0 && !error ? (
        <p className="nm-hub-muted nm-hub-printed-feedback">No hay imágenes cargadas para este día.</p>
      ) : null}

      {configured && showGlobalSpinner ? (
        <div className="nm-hub-printed-loading" role="status" aria-live="polite">
          <div className="nm-hub-spinner" aria-hidden="true" />
          <p className="nm-hub-loading-label">Buscando archivos…</p>
        </div>
      ) : null}

      {configured && !rowsLoading && availableFamilies.length > 0 && !showGallerySpinner && viewableRows.length === 0 ? (
        <p className="nm-hub-muted nm-hub-printed-feedback">
          No hay imágenes en esta categoría para el día.
        </p>
      ) : null}

      {configured && showGallerySpinner ? (
        <div className="nm-hub-printed-loading nm-hub-printed-loading--inline" role="status" aria-live="polite">
          <div className="nm-hub-spinner" aria-hidden="true" />
          <p className="nm-hub-loading-label">Preparando vistas previas…</p>
        </div>
      ) : null}

      {configured && !rowsLoading && !showGallerySpinner && viewableRows.length > 0 ? (
        <div className="print-design-feed-container">
          <div className="design-gallery-feed" aria-label={`Diseños ${NM_PROD_MATERIAL_FAMILY_LABEL[activeFamily]}`}>
            {viewableRows.map((r, idx) => {
              const src = urls[r.id] as string
              const fam = r.material_family
              const kindLabel = NM_PROD_MATERIAL_FAMILY_LABEL[fam]
              return (
                <button
                  key={r.id}
                  type="button"
                  className={`design-item-card design-item-card--${fam}`}
                  onClick={() => setLightboxIndex(idx)}
                  aria-label={`Ampliar ${kindLabel} ${idx + 1}`}
                >
                  <div className="design-item-card__media">
                    <img src={src} alt="" className="design-item-card__img" decoding="async" loading="lazy" />
                  </div>
                  <p className="design-card-meta">{`${kindLabel} diseño · #${idx + 1}`}</p>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {lightboxIndex !== null && viewableRows[lightboxIndex] ? (
        <HubImageLightbox
          src={urls[viewableRows[lightboxIndex].id] ?? ''}
          onClose={() => setLightboxIndex(null)}
          gallery={
            viewableRows.length > 1
              ? {
                  index: lightboxIndex,
                  total: viewableRows.length,
                  onPrev: goLightboxPrev,
                  onNext: goLightboxNext,
                }
              : undefined
          }
        />
      ) : null}
    </div>
  )
}
