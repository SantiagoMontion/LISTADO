import { useCallback, useEffect, useMemo, useState } from 'react'
import JSZip from 'jszip'
import { HubBrandBar } from './HubBrandBar'
import { HubDesktopNav } from './HubDesktopNav'
import { formatSupabaseOrError } from '../lib/errors'
import {
  fetchPersonalizadosPdfFile,
  listPendingPersonalizadosPdfs,
  partitionOrdersForPapelTag,
  tagOrdersWithPapel,
  type PersonalizadosPdfRow,
} from '../lib/personalizadosPdfsApi'
import { shopifyOrderAdminUrlById } from '../lib/shopifyOrderUrl'
import type { HubUserRole } from '../lib/types'

interface HubPersonalizadosPdfsAppProps {
  profileRole?: HubUserRole | null
  adminSignOut?: boolean
}

type StatusFilter = 'all' | 'matched' | 'skipped'

function todayStamp(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function skipReasonLabel(reason: string | null): string {
  if (!reason) return 'Revisar manual'
  if (reason === 'print_not_found') return 'Revisar manual'
  if (reason === 'ambiguous_design_name') return 'Nombre ambiguo'
  if (reason === 'object_not_found' || reason === 'missing_file_path') return 'Archivo ausente'
  return reason
}

/** Cualquier salteado se puede pasar a OK a mano (y gatillar Papel). */
function canMarkManualOk(row: PersonalizadosPdfRow): boolean {
  return row.status === 'skipped'
}

function uniqueMatchedForZip(rows: PersonalizadosPdfRow[]): PersonalizadosPdfRow[] {
  const seen = new Set<string>()
  const out: PersonalizadosPdfRow[] = []
  for (const row of rows) {
    if (row.status !== 'matched' || !row.printId) continue
    if (seen.has(row.printId)) continue
    seen.add(row.printId)
    out.push(row)
  }
  return out
}

function rowKey(row: PersonalizadosPdfRow): string {
  return `${row.orderId}-${row.lineItemId}-${row.jobId || row.printId || row.lineTitle}`
}

export function HubPersonalizadosPdfsApp({
  profileRole,
  adminSignOut = false,
}: HubPersonalizadosPdfsAppProps) {
  const [rows, setRows] = useState<PersonalizadosPdfRow[]>([])
  const [matched, setMatched] = useState(0)
  const [skipped, setSkipped] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [zipBusy, setZipBusy] = useState(false)
  const [zipProgress, setZipProgress] = useState<{ current: number; total: number } | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [expandedMobileIds, setExpandedMobileIds] = useState<Set<string>>(() => new Set())
  const [manualOkIds, setManualOkIds] = useState<Set<string>>(() => new Set())
  const [manualBusyId, setManualBusyId] = useState<string | null>(null)
  const [copiedTitleId, setCopiedTitleId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotice(null)
    setWarning(null)
    setManualOkIds(new Set())
    setManualBusyId(null)
    try {
      const data = await listPendingPersonalizadosPdfs()
      setRows(data.rows)
      setMatched(data.matched)
      setSkipped(data.skipped)
    } catch (e) {
      setError(formatSupabaseOrError(e))
      setRows([])
      setMatched(0)
      setSkipped(0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const zipTargets = useMemo(() => uniqueMatchedForZip(rows), [rows])

  const displayMatched = matched + manualOkIds.size
  const displaySkipped = Math.max(0, skipped - manualOkIds.size)

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((row) => {
      const id = rowKey(row)
      const isManualOk = manualOkIds.has(id)
      const looksOk = row.status === 'matched' || isManualOk
      if (statusFilter === 'matched' && !looksOk) return false
      if (statusFilter === 'skipped' && looksOk) return false
      if (!q) return true
      const hay = [
        row.orderName,
        row.lineTitle,
        row.jobId || '',
        row.fileName || '',
        row.reason || '',
        isManualOk ? 'ok' : '',
        canMarkManualOk(row) && !isManualOk ? skipReasonLabel(row.reason) : '',
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [manualOkIds, query, rows, statusFilter])

  function toggleMobileCard(id: string) {
    setExpandedMobileIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function copyLineTitle(row: PersonalizadosPdfRow) {
    const text = (row.lineTitle || '').trim()
    if (!text) return
    const id = rowKey(row)
    try {
      await navigator.clipboard.writeText(text)
      setCopiedTitleId(id)
      window.setTimeout(() => {
        setCopiedTitleId((prev) => (prev === id ? null : prev))
      }, 1400)
    } catch {
      setWarning(`No se pudo copiar el título de ${row.orderName}.`)
    }
  }

  /**
   * Salteado → OK. Etiqueta Papel solo si el pedido queda completo
   * (todas las líneas matched o pasadas a OK a mano). Los OK automáticos del match
   * no gatillan Papel por este camino.
   */
  async function onManualOk(row: PersonalizadosPdfRow) {
    const id = rowKey(row)
    if (!canMarkManualOk(row) || manualOkIds.has(id) || manualBusyId) return

    const nextManual = new Set(manualOkIds)
    nextManual.add(id)
    setManualOkIds(nextManual)
    setManualBusyId(id)
    setWarning(null)

    const orderRows = rows.filter((r) => r.orderId === row.orderId)
    const orderComplete = orderRows.every((r) => {
      const key = rowKey(r)
      return r.status === 'matched' || nextManual.has(key)
    })

    if (!orderComplete) {
      setManualBusyId(null)
      setNotice(
        `${row.orderName}: marcado OK. Falta revisar otra línea del mismo pedido antes de «Papel».`,
      )
      return
    }

    try {
      const tagResult = await tagOrdersWithPapel([row.orderId])
      const result = tagResult.results[0]
      if (!result?.ok) {
        throw new Error(result?.error || 'No se pudo etiquetar Papel')
      }
      setRows((prev) => prev.filter((r) => r.orderId !== row.orderId))
      setManualOkIds((prev) => {
        const cleaned = new Set<string>()
        for (const key of prev) {
          if (!key.startsWith(`${row.orderId}-`)) cleaned.add(key)
        }
        return cleaned
      })
      setMatched((n) => Math.max(0, n - orderRows.filter((r) => r.status === 'matched').length))
      setSkipped((n) =>
        Math.max(0, n - orderRows.filter((r) => r.status === 'skipped').length),
      )
      setNotice(
        `${row.orderName}: OK manual → etiqueta «Papel» aplicada. Sale del listado.`,
      )
    } catch (e) {
      setManualOkIds((prev) => {
        const reverted = new Set(prev)
        reverted.delete(id)
        return reverted
      })
      setWarning(
        `${row.orderName}: no se pudo etiquetar «Papel»: ${formatSupabaseOrError(e)}`,
      )
    } finally {
      setManualBusyId(null)
    }
  }

  async function onDownloadZip() {
    if (!zipTargets.length || zipBusy) return
    setZipBusy(true)
    setNotice(null)
    setWarning(null)
    setError(null)
    setZipProgress({ current: 0, total: zipTargets.length })

    const downloadedPrintIds: string[] = []

    try {
      const zip = new JSZip()
      const usedNames = new Set<string>()

      for (let i = 0; i < zipTargets.length; i += 1) {
        const row = zipTargets[i]
        setZipProgress({ current: i + 1, total: zipTargets.length })
        const { blob, fileName } = await fetchPersonalizadosPdfFile(row.printId!)
        const baseName = fileName || `${row.orderName}-${row.jobId || row.printId}.pdf`
        let finalName = baseName
        let n = 2
        while (usedNames.has(finalName.toLowerCase())) {
          const dot = baseName.lastIndexOf('.')
          if (dot > 0) {
            finalName = `${baseName.slice(0, dot)}-${n}${baseName.slice(dot)}`
          } else {
            finalName = `${baseName}-${n}`
          }
          n += 1
        }
        usedNames.add(finalName.toLowerCase())
        zip.file(finalName, blob)
        if (row.printId) downloadedPrintIds.push(row.printId)
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pdfs-impresion-${todayStamp()}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)

      const { complete, partial } = partitionOrdersForPapelTag(rows, downloadedPrintIds)

      let tagNotice = ''
      if (complete.length) {
        try {
          const tagResult = await tagOrdersWithPapel(complete.map((o) => o.orderId))
          const okNames = tagResult.results
            .filter((r) => r.ok)
            .map((r) => r.orderName)
          const failNames = tagResult.results
            .filter((r) => !r.ok)
            .map((r) => r.orderName)
          tagNotice =
            okNames.length > 0
              ? ` Etiqueta «Papel» en ${okNames.length} pedido${okNames.length === 1 ? '' : 's'}: ${okNames.join(', ')}.`
              : ''
          if (failNames.length) {
            setWarning(
              `No se pudo etiquetar en Shopify: ${failNames.join(', ')}. Revisá el scope write_orders del token.`,
            )
          }
        } catch (tagErr) {
          setWarning(
            `ZIP OK, pero falló etiquetar «Papel»: ${formatSupabaseOrError(tagErr)}`,
          )
        }
      }

      setNotice(
        `ZIP listo: ${zipTargets.length} PDF${zipTargets.length === 1 ? '' : 's'}.${tagNotice}`,
      )

      if (partial.length) {
        const partialMsg = partial
          .map(
            (o) =>
              `${o.orderName} (${o.matched} OK / ${o.skipped} sin PDF)`,
          )
          .join('; ')
        setWarning((prev) =>
          [
            prev,
            `Sin etiqueta «Papel» (pedido incompleto): ${partialMsg}.`,
          ]
            .filter(Boolean)
            .join(' '),
        )
      }
    } catch (e) {
      setError(formatSupabaseOrError(e))
    } finally {
      setZipBusy(false)
      setZipProgress(null)
    }
  }

  return (
    <div className="nm-hub-app nm-hub-app--tasks nm-hub-app--pdfs">
      <header className="nm-hub-header dashboard-navbar">
        <HubBrandBar
          integratedDashboard
          integratedSubtitle="PDFs impresión"
          adminSignOut={adminSignOut}
        />
      </header>

      <HubDesktopNav role={profileRole} />

      {error ? (
        <p className="nm-hub-error" role="alert">
          {error}
        </p>
      ) : null}

      <section
        className="nm-hub-section nm-hub-section--task-list"
        aria-labelledby="hub-pdfs-title"
      >
        <header className="hub-page-head hub-page-head--with-action">
          <div className="hub-page-head__main">
            <h1 id="hub-pdfs-title" className="hub-page-head__title">
              PDFs de impresión
            </h1>
            <p className="hub-page-head__lead">
              Pedidos pagados, sin preparar y sin etiqueta «Papel».
            </p>
          </div>
          <div className="hub-pdfs-head-actions">
            <button
              type="button"
              className="hub-pdfs-secondary-action"
              onClick={() => void reload()}
              disabled={loading || zipBusy}
            >
              {loading ? 'Actualizando…' : 'Actualizar'}
            </button>
            <button
              type="button"
              className="hub-page-primary-action"
              onClick={() => void onDownloadZip()}
              disabled={loading || zipBusy || zipTargets.length === 0}
            >
              {zipBusy && zipProgress
                ? `Descargando ${zipProgress.current}/${zipProgress.total}…`
                : 'Descargar PDFs'}
            </button>
          </div>
        </header>

        <div className="hub-tasks-toolbar">
          <div className="hub-tasks-filters" role="search">
            <div className="nm-hub-task-search-wrap tasks-hub-search-wrap">
              <label className="nm-hub-sr-only" htmlFor="nm-hub-pdfs-q">
                Buscar en PDFs
              </label>
              <input
                id="nm-hub-pdfs-q"
                type="search"
                className="nm-hub-input field-input nm-hub-task-search"
                placeholder="Buscar"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div
              className="hub-tasks-completion-seg"
              role="group"
              aria-label="Filtrar por estado de match"
            >
              {(
                [
                  { value: 'all', label: 'Todos' },
                  { value: 'matched', label: 'OK' },
                  { value: 'skipped', label: 'Salteados' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`hub-tasks-completion-seg__btn${
                    statusFilter === opt.value
                      ? ' hub-tasks-completion-seg__btn--active'
                      : ''
                  }`}
                  aria-pressed={statusFilter === opt.value}
                  onClick={() => setStatusFilter(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <p className="hub-pdfs-counts" aria-label="Resumen de estados">
            <span className="hub-pdfs-count hub-pdfs-count--ok">
              OK: <strong>{displayMatched}</strong>
            </span>
            <span className="hub-pdfs-count hub-pdfs-count--review">
              Revisar: <strong>{displaySkipped}</strong>
            </span>
          </p>
        </div>

        {notice ? (
          <p className="hub-pdfs-notice" role="status">
            {notice}
          </p>
        ) : null}
        {warning ? (
          <p className="hub-pdfs-warning" role="status">
            {warning}
          </p>
        ) : null}

        {loading && rows.length === 0 ? (
          <p className="nm-hub-muted">Cargando…</p>
        ) : null}
        {!loading && rows.length === 0 ? (
          <p className="nm-hub-muted">
            No hay líneas personalizadas pendientes.
          </p>
        ) : null}
        {!loading && rows.length > 0 && filteredRows.length === 0 ? (
          <p className="nm-hub-muted">Ninguna línea coincide con los filtros.</p>
        ) : null}

        <div className="hub-tasks-table-wrap" aria-busy={loading}>
          <table className="hub-tasks-table hub-pdfs-table">
            <thead>
              <tr>
                <th scope="col" className="hub-tasks-table__col-title">
                  Pedido
                </th>
                <th scope="col" className="hub-pdfs-table__col-line">
                  Título
                </th>
                <th scope="col" className="hub-tasks-table__col-status">
                  Estado
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const id = rowKey(row)
                const mobileOpen = expandedMobileIds.has(id)
                const isManualOk = manualOkIds.has(id)
                const ok = row.status === 'matched' || isManualOk
                const canManualOk = canMarkManualOk(row) && !isManualOk
                const shopifyUrl = shopifyOrderAdminUrlById(row.orderId)
                const rowClass = `hub-tasks-table__row hub-tasks-table__row--pending${
                  mobileOpen ? ' hub-tasks-table__row--mobile-open' : ''
                }${isManualOk ? ' hub-pdfs-row--manual-ok' : ''}${
                  canManualOk ? ' hub-pdfs-row--needs-review' : ''
                }`

                return (
                  <tr key={id} className={rowClass}>
                    <td className="hub-tasks-table__title">
                      <div className="hub-pdfs-title-row">
                        {shopifyUrl ? (
                          <a
                            className="hub-tasks-table__title-link"
                            href={shopifyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Abrir en Shopify (${row.orderName})`}
                            onClick={(e) => {
                              if (
                                !mobileOpen &&
                                window.matchMedia('(max-width: 1023.98px)').matches
                              ) {
                                e.preventDefault()
                                toggleMobileCard(id)
                              }
                            }}
                          >
                            {row.orderName}
                          </a>
                        ) : (
                          <span className="hub-tasks-table__title-text">{row.orderName}</span>
                        )}
                        <button
                          type="button"
                          className="hub-tasks-table__mobile-chevron"
                          onClick={() => toggleMobileCard(id)}
                          aria-expanded={mobileOpen}
                          aria-label={
                            mobileOpen
                              ? `Cerrar ${row.orderName}`
                              : `Abrir ${row.orderName}`
                          }
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path
                              d="M6 9l6 6 6-6"
                              stroke="currentColor"
                              strokeWidth="2.25"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>
                    </td>
                    <td className="hub-pdfs-table__line">
                      <button
                        type="button"
                        className={`hub-pdfs-line-title hub-pdfs-line-title--copy${
                          copiedTitleId === id ? ' hub-pdfs-line-title--copied' : ''
                        }`}
                        onClick={() => void copyLineTitle(row)}
                        title={
                          copiedTitleId === id
                            ? 'Título copiado'
                            : 'Clic para copiar el título'
                        }
                        aria-label={
                          copiedTitleId === id
                            ? `Título de ${row.orderName} copiado`
                            : `Copiar título: ${row.lineTitle}`
                        }
                      >
                        <span className="hub-pdfs-line-title__text">
                          {row.lineTitle}
                          {row.quantity > 1 ? (
                            <span className="nm-hub-muted"> ×{row.quantity}</span>
                          ) : null}
                        </span>
                        {copiedTitleId === id ? (
                          <span className="hub-pdfs-line-title__hint">Copiado</span>
                        ) : null}
                      </button>
                    </td>
                    <td className="hub-tasks-table__status">
                      {ok ? (
                        <span
                          className={`hub-pdfs-status hub-pdfs-status--ok${
                            isManualOk ? ' hub-pdfs-status--ok-manual' : ''
                          }`}
                        >
                          OK
                        </span>
                      ) : canManualOk ? (
                        <button
                          type="button"
                          className={`hub-pdfs-status hub-pdfs-status--skip hub-pdfs-status--action${
                            manualBusyId === id ? ' hub-pdfs-status--busy' : ''
                          }`}
                          disabled={Boolean(manualBusyId) || zipBusy}
                          onClick={() => void onManualOk(row)}
                          title="Clic para marcar OK"
                        >
                          {manualBusyId === id ? 'Aplicando…' : skipReasonLabel(row.reason)}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
