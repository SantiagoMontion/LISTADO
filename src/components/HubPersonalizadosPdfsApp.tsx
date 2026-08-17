import { useCallback, useEffect, useMemo, useState } from 'react'
import JSZip from 'jszip'
import { HubBrandBar } from './HubBrandBar'
import { HubDesktopNav } from './HubDesktopNav'
import { HubTasksPillSelect, type HubTasksPillOption } from './HubTasksPillSelect'
import { formatSupabaseOrError } from '../lib/errors'
import {
  fetchPersonalizadosPdfFile,
  listPendingPersonalizadosPdfs,
  partitionOrdersForPapelTag,
  tagOrdersWithPapel,
  copyablePersonalizadosTitle,
  expandMatchedRowsForZip,
  mergeIdenticalProductRows,
  personalizadosRowKey,
  type PersonalizadosPdfRow,
  type PersonalizadosProductGroup,
} from '../lib/personalizadosPdfsApi'
import { shopifyOrderAdminUrlById } from '../lib/shopifyOrderUrl'
import type { HubUserRole } from '../lib/types'

interface HubPersonalizadosPdfsAppProps {
  profileRole?: HubUserRole | null
  adminSignOut?: boolean
}

type StatusFilter = 'all' | 'matched' | 'skipped'
type LineStatus = 'pendiente' | 'ok'

const LINE_STATUS_OPTIONS: HubTasksPillOption<LineStatus>[] = [
  {
    value: 'pendiente',
    label: 'Pendiente',
    toneClass: 'hub-tasks-tracking-sent-select--pendiente',
  },
  {
    value: 'ok',
    label: 'OK',
    toneClass: 'hub-tasks-tracking-sent-select--enviado',
  },
]

function todayStamp(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isGroupOk(group: PersonalizadosProductGroup, manualOkIds: Set<string>): boolean {
  if (group.status === 'matched') return true
  return group.members.every((m) => manualOkIds.has(personalizadosRowKey(m)))
}

export function HubPersonalizadosPdfsApp({
  profileRole,
  adminSignOut = false,
}: HubPersonalizadosPdfsAppProps) {
  const [rows, setRows] = useState<PersonalizadosPdfRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [zipBusy, setZipBusy] = useState(false)
  const [zipProgress, setZipProgress] = useState<{ current: number; total: number } | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [manualOkIds, setManualOkIds] = useState<Set<string>>(() => new Set())
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null)
  const [copiedTitleId, setCopiedTitleId] = useState<string | null>(null)
  const [copiedDesignId, setCopiedDesignId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotice(null)
    setWarning(null)
    setManualOkIds(new Set())
    setStatusBusyId(null)
    try {
      const data = await listPendingPersonalizadosPdfs()
      setRows(data.rows)
    } catch (e) {
      setError(formatSupabaseOrError(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const zipTargets = useMemo(() => expandMatchedRowsForZip(rows), [rows])

  const productGroups = useMemo(() => mergeIdenticalProductRows(rows), [rows])

  const displayMatched = useMemo(
    () => productGroups.filter((g) => isGroupOk(g, manualOkIds)).length,
    [manualOkIds, productGroups],
  )
  const displaySkipped = Math.max(0, productGroups.length - displayMatched)

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    return productGroups.filter((group) => {
      const looksOk = isGroupOk(group, manualOkIds)
      if (statusFilter === 'matched' && !looksOk) return false
      if (statusFilter === 'skipped' && looksOk) return false
      if (!q) return true
      const hay = [group.orderName, group.lineTitle, group.jobId || '', group.fileName || '']
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [manualOkIds, productGroups, query, statusFilter])

  const ordersGrouped = useMemo(() => {
    const map = new Map<string, PersonalizadosProductGroup[]>()
    for (const group of filteredGroups) {
      const list = map.get(group.orderId) || []
      list.push(group)
      map.set(group.orderId, list)
    }
    return [...map.entries()].map(([orderId, lines]) => ({
      orderId,
      orderName: lines[0]?.orderName || `#${orderId}`,
      lines,
    }))
  }, [filteredGroups])

  async function copyLineTitle(group: PersonalizadosProductGroup) {
    const text = copyablePersonalizadosTitle(group.lineTitle)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedTitleId(group.groupId)
      window.setTimeout(() => {
        setCopiedTitleId((prev) => (prev === group.groupId ? null : prev))
      }, 1400)
    } catch {
      setWarning(`No se pudo copiar el título de ${group.orderName}.`)
    }
  }

  /** Prueba temporal: copia design_name completo de Supabase. */
  async function copySupabaseDesignName(group: PersonalizadosProductGroup) {
    const text = (group.designName || '').trim()
    if (!text) {
      setWarning(`${group.orderName}: no hay design_name en Supabase para copiar.`)
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopiedDesignId(group.groupId)
      window.setTimeout(() => {
        setCopiedDesignId((prev) => (prev === group.groupId ? null : prev))
      }, 1600)
    } catch {
      setWarning(`No se pudo copiar design_name de ${group.orderName}.`)
    }
  }

  async function applyPapelIfOrderComplete(
    orderId: string,
    orderName: string,
    nextManual: Set<string>,
  ) {
    const orderRows = rows.filter((r) => r.orderId === orderId)
    const orderComplete = orderRows.every(
      (r) => r.status === 'matched' || nextManual.has(personalizadosRowKey(r)),
    )
    if (!orderComplete) {
      setNotice(
        `${orderName}: estado actualizado. Falta marcar OK en otro producto antes de «Papel».`,
      )
      return
    }

    const tagResult = await tagOrdersWithPapel([orderId])
    const result = tagResult.results[0]
    if (!result?.ok) {
      throw new Error(result?.error || 'No se pudo etiquetar Papel')
    }
    setRows((prev) => prev.filter((r) => r.orderId !== orderId))
    setManualOkIds((prev) => {
      const cleaned = new Set<string>()
      for (const key of prev) {
        if (!key.startsWith(`${orderId}-`)) cleaned.add(key)
      }
      return cleaned
    })
    setNotice(`${orderName}: todos los productos OK → etiqueta «Papel». Sale del listado.`)
  }

  async function onGroupStatusChange(group: PersonalizadosProductGroup, value: LineStatus) {
    if (statusBusyId || zipBusy) return

    if (group.status === 'matched') {
      if (value === 'pendiente') {
        setNotice(`${group.orderName}: este producto ya tiene PDF; queda en OK.`)
      }
      return
    }

    const memberKeys = group.members.map((m) => personalizadosRowKey(m))

    if (value === 'ok') {
      const nextManual = new Set(manualOkIds)
      for (const key of memberKeys) nextManual.add(key)
      setManualOkIds(nextManual)
      setStatusBusyId(group.groupId)
      setWarning(null)
      try {
        await applyPapelIfOrderComplete(group.orderId, group.orderName, nextManual)
      } catch (e) {
        setManualOkIds((prev) => {
          const reverted = new Set(prev)
          for (const key of memberKeys) reverted.delete(key)
          return reverted
        })
        setWarning(
          `${group.orderName}: no se pudo etiquetar «Papel»: ${formatSupabaseOrError(e)}`,
        )
      } finally {
        setStatusBusyId(null)
      }
      return
    }

    setManualOkIds((prev) => {
      const next = new Set(prev)
      for (const key of memberKeys) next.delete(key)
      return next
    })
    setNotice(`${group.orderName}: producto vuelto a Pendiente.`)
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
      const blobCache = new Map<string, { blob: Blob; fileName: string }>()

      for (let i = 0; i < zipTargets.length; i += 1) {
        const row = zipTargets[i]
        setZipProgress({ current: i + 1, total: zipTargets.length })
        const printId = row.printId!
        let cached = blobCache.get(printId)
        if (!cached) {
          cached = await fetchPersonalizadosPdfFile(printId)
          blobCache.set(printId, cached)
        }
        const { blob, fileName } = cached
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

      const { complete, partial } = partitionOrdersForPapelTag(
        rows,
        downloadedPrintIds,
        manualOkIds,
      )

      let tagNotice = ''
      if (complete.length) {
        try {
          const tagResult = await tagOrdersWithPapel(complete.map((o) => o.orderId))
          const okNames = tagResult.results.filter((r) => r.ok).map((r) => r.orderName)
          const failNames = tagResult.results.filter((r) => !r.ok).map((r) => r.orderName)
          tagNotice =
            okNames.length > 0
              ? ` Etiqueta «Papel» en ${okNames.length} pedido${okNames.length === 1 ? '' : 's'}: ${okNames.join(', ')}.`
              : ''
          if (failNames.length) {
            setWarning(
              `No se pudo etiquetar en Shopify: ${failNames.join(', ')}. Revisá el scope write_orders del token.`,
            )
          }
          if (okNames.length) {
            const doneIds = new Set(complete.map((o) => o.orderId))
            setRows((prev) => prev.filter((r) => !doneIds.has(r.orderId)))
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
          .map((o) => `${o.orderName} (${o.matched} OK / ${o.skipped} pendientes)`)
          .join('; ')
        setWarning((prev) =>
          [prev, `Sin etiqueta «Papel» (pedido incompleto): ${partialMsg}.`]
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
              aria-label="Filtrar por estado"
            >
              <button
                type="button"
                className={`hub-tasks-completion-seg__btn${
                  statusFilter === 'all' ? ' hub-tasks-completion-seg__btn--active' : ''
                }`}
                aria-pressed={statusFilter === 'all'}
                onClick={() => setStatusFilter('all')}
              >
                Todos ({displayMatched + displaySkipped})
              </button>
              <button
                type="button"
                className={`hub-tasks-completion-seg__btn${
                  statusFilter === 'matched' ? ' hub-tasks-completion-seg__btn--active' : ''
                }`}
                aria-pressed={statusFilter === 'matched'}
                onClick={() => setStatusFilter('matched')}
              >
                OK (
                <span className="hub-pdfs-filter-num hub-pdfs-filter-num--ok">
                  {displayMatched}
                </span>
                )
              </button>
              <button
                type="button"
                className={`hub-tasks-completion-seg__btn${
                  statusFilter === 'skipped' ? ' hub-tasks-completion-seg__btn--active' : ''
                }`}
                aria-pressed={statusFilter === 'skipped'}
                onClick={() => setStatusFilter('skipped')}
              >
                Pendientes (
                <span className="hub-pdfs-filter-num hub-pdfs-filter-num--review">
                  {displaySkipped}
                </span>
                )
              </button>
            </div>
          </div>
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
          <p className="nm-hub-muted">No hay pedidos pendientes.</p>
        ) : null}
        {!loading && rows.length > 0 && ordersGrouped.length === 0 ? (
          <p className="nm-hub-muted">Ningún pedido coincide con los filtros.</p>
        ) : null}

        <ul className="hub-pdfs-orders" aria-busy={loading}>
          {ordersGrouped.map((order) => {
            const shopifyUrl = shopifyOrderAdminUrlById(order.orderId)
            return (
              <li key={order.orderId} className="hub-pdfs-order-card">
                <div className="hub-pdfs-order-card__head">
                  {shopifyUrl ? (
                    <a
                      className="hub-pdfs-order-card__order"
                      href={shopifyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {order.orderName}
                    </a>
                  ) : (
                    <span className="hub-pdfs-order-card__order">{order.orderName}</span>
                  )}
                  <span className="hub-pdfs-order-card__meta">
                    {order.lines.length} producto{order.lines.length === 1 ? '' : 's'}
                  </span>
                </div>

                <ul className="hub-pdfs-order-lines">
                  {order.lines.map((group) => {
                    const ok = isGroupOk(group, manualOkIds)
                    const statusValue: LineStatus = ok ? 'ok' : 'pendiente'
                    const canChange = group.status === 'skipped'
                    return (
                      <li key={group.groupId} className="hub-pdfs-order-line">
                        <button
                          type="button"
                          className={`hub-pdfs-line-title hub-pdfs-line-title--copy${
                            copiedTitleId === group.groupId ? ' hub-pdfs-line-title--copied' : ''
                          }`}
                          onClick={() => void copyLineTitle(group)}
                          title={
                            copiedTitleId === group.groupId
                              ? 'Título copiado'
                              : 'Clic para copiar el título'
                          }
                        >
                          <span className="hub-pdfs-line-title__text">
                            {group.lineTitle}
                            {group.quantity > 1 ? (
                              <span className="nm-hub-muted"> ×{group.quantity}</span>
                            ) : null}
                          </span>
                          {copiedTitleId === group.groupId ? (
                            <span className="hub-pdfs-line-title__hint">Copiado</span>
                          ) : null}
                        </button>

                        <div className="hub-pdfs-order-line__status">
                          {group.status === 'matched' ? (
                            <button
                              type="button"
                              className="hub-pdfs-copy-supabase"
                              onClick={() => void copySupabaseDesignName(group)}
                              title={
                                group.designName
                                  ? `Copiar de Supabase: ${group.designName}`
                                  : 'Sin design_name en Supabase'
                              }
                            >
                              {copiedDesignId === group.groupId ? 'Copiado' : 'Copiar'}
                            </button>
                          ) : null}
                          <HubTasksPillSelect
                            value={statusValue}
                            options={LINE_STATUS_OPTIONS}
                            aria-label={`Estado ${group.lineTitle}`}
                            pillClassName="hub-tasks-status-select"
                            disabled={
                              !canChange || Boolean(statusBusyId) || zipBusy
                            }
                            onChange={(value) => void onGroupStatusChange(group, value)}
                          />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
