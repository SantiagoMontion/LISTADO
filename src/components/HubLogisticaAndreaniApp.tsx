import { useCallback, useEffect, useRef, useState } from 'react'
import { HubBrandBar } from './HubBrandBar'
import { HubDesktopNav } from './HubDesktopNav'
import {
  fetchLogisticsStatus,
  getLogisticsApiHint,
  probeLogisticsApiHealth,
  streamExport,
  triggerDownloads,
  type HeldOrder,
  type LogisticsEvent,
  type LogisticsLogLevel,
  type LogisticsMetrics,
  type PendingExportOrder,
  type WarningOrder,
} from '../lib/logisticaAndreaniApi'
import type { HubUserRole } from '../lib/types'

interface HubLogisticaAndreaniAppProps {
  profileRole?: HubUserRole | null
  adminSignOut?: boolean
}

interface LogLine {
  id: number
  level: LogisticsLogLevel
  message: string
  ts: string
}

const EMPTY_METRICS: LogisticsMetrics = {
  pending_export: 0,
  missing_tracking: 0,
  errors: 0,
  warnings: 0,
}

const EXPORT_PREVIEW_PAGE = 10

const OBSOLETE_WARNING_PATTERNS = [/Metodo_Envio/i, /selector del carrito/i]

function filterObsoleteWarnings(orders: WarningOrder[]): WarningOrder[] {
  return orders
    .map((row) => {
      const items = (row.warnings?.length ? row.warnings : row.warning ? [row.warning] : []).filter(
        (item) => !OBSOLETE_WARNING_PATTERNS.some((pattern) => pattern.test(item)),
      )
      return { ...row, warnings: items, warning: items.join('; ') }
    })
    .filter((row) => (row.warnings?.length ?? 0) > 0)
}

const LOG_CLASS: Record<LogisticsLogLevel, string> = {
  info: 'logistica-console__msg--info',
  success: 'logistica-console__msg--success',
  warning: 'logistica-console__msg--warning',
  error: 'logistica-console__msg--error',
}

function formatTime(): string {
  return new Date().toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function renderLogLines(lines: LogLine[]) {
  return lines.map((line) => (
    <div key={line.id} className="logistica-console__line">
      <span className="logistica-console__ts">[{line.ts}]</span>
      <span className={LOG_CLASS[line.level]}>{line.message}</span>
    </div>
  ))
}

export function HubLogisticaAndreaniApp({
  profileRole,
  adminSignOut = false,
}: HubLogisticaAndreaniAppProps) {
  const configHint = getLogisticsApiHint()
  const [apiOnline, setApiOnline] = useState<boolean | null>(null)
  const [metrics, setMetrics] = useState<LogisticsMetrics>(EMPTY_METRICS)
  const [heldOrders, setHeldOrders] = useState<HeldOrder[]>([])
  const [warningOrders, setWarningOrders] = useState<WarningOrder[]>([])
  const [pendingOrders, setPendingOrders] = useState<PendingExportOrder[]>([])
  const [pendingPage, setPendingPage] = useState(1)
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  const [exportRunning, setExportRunning] = useState(false)
  const [exportFinished, setExportFinished] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportLogs, setExportLogs] = useState<LogLine[]>([])

  const exportLogIdRef = useRef(0)
  const streamCloserRef = useRef<(() => void) | null>(null)

  const pushExportLog = useCallback((level: LogisticsLogLevel, message: string) => {
    exportLogIdRef.current += 1
    setExportLogs((prev) => [
      ...prev.slice(-400),
      { id: exportLogIdRef.current, level, message, ts: formatTime() },
    ])
  }, [])

  const refreshStatus = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false
    setLoadingStatus(true)
    if (!silent) {
      setStatusError(null)
    }
    try {
      if (configHint) {
        setApiOnline(false)
        if (!silent) setStatusError(configHint)
        return
      }
      const probe = await probeLogisticsApiHealth()
      setApiOnline(probe.ok)
      if (!probe.ok) {
        if (!silent) {
          setStatusError(
            probe.error ||
              'No se pudo conectar con Railway. Revisá VITE_ANDREANI_API_URL y CORS en Railway.',
          )
        }
        return
      }
      const data = await fetchLogisticsStatus()
      const visibleWarnings = filterObsoleteWarnings(data.warning_orders ?? [])
      setMetrics({
        ...EMPTY_METRICS,
        ...data.metrics,
        warnings: visibleWarnings.length,
      })
      setHeldOrders(data.held_orders)
      setWarningOrders(visibleWarnings)
      setPendingOrders(data.pending_orders ?? [])
      setPendingPage(1)
      if (!silent) {
        setStatusError(null)
      }
    } catch (err: unknown) {
      setApiOnline(false)
      if (!silent) {
        setStatusError(err instanceof Error ? err.message : 'Error al consultar estado')
      }
    } finally {
      setLoadingStatus(false)
    }
  }, [configHint])

  const handleExportEvent = useCallback(
    (event: LogisticsEvent) => {
      if (event.type === 'log') {
        pushExportLog(event.level ?? 'info', event.message)
      } else if (event.type === 'progress') {
        setExportProgress(event.percent ?? 0)
      } else if (event.type === 'complete') {
        setExportProgress(100)
        pushExportLog('success', event.message)
        const summary = event.data?.summary as
          | { filename?: string; filenames?: string[] }
          | undefined
        const downloadNames =
          (event.data?.download_names as string[] | undefined)?.filter(Boolean) ??
          summary?.filenames?.filter(Boolean) ??
          []
        const fallbackName =
          (event.data?.download_name as string | undefined) || summary?.filename
        const files = downloadNames.length > 0 ? downloadNames : fallbackName ? [fallbackName] : []
        if (files.length > 0) {
          if (files.length === 1) {
            pushExportLog('success', `Descargando ${files[0]}…`)
          } else {
            pushExportLog(
              'success',
              `Descargando ${files.length} archivos (máx. 10 pedidos c/u para cupón Andreani)…`,
            )
          }
          void (async () => {
            try {
              await triggerDownloads(files, (name, index, total) => {
                pushExportLog('info', `Descargando ${index + 1}/${total}: ${name}`)
              })
              pushExportLog('success', 'Descarga(s) completada(s).')
            } catch (err: unknown) {
              pushExportLog(
                'error',
                err instanceof Error ? err.message : 'Error al descargar el Excel',
              )
            }
          })()
        }
        setExportRunning(false)
        setExportFinished(true)
        window.setTimeout(() => {
          void refreshStatus({ silent: true })
        }, 3000)
      } else if (event.type === 'error') {
        pushExportLog('error', event.message)
        setExportRunning(false)
        setExportFinished(true)
      }
    },
    [pushExportLog, refreshStatus],
  )

  useEffect(() => {
    void refreshStatus()
    const interval = window.setInterval(() => void refreshStatus(), 60_000)
    return () => {
      window.clearInterval(interval)
      streamCloserRef.current?.()
    }
  }, [refreshStatus])

  const startExport = () => {
    if (exportRunning) return
    streamCloserRef.current?.()
    setExportRunning(true)
    setExportFinished(false)
    setExportProgress(0)
    setExportLogs([])
    exportLogIdRef.current = 0
    pushExportLog('info', 'Generando carga masiva Andreani…')
    const { close } = streamExport({}, handleExportEvent)
    streamCloserRef.current = close
  }

  const pendingTotalPages = Math.max(1, Math.ceil(pendingOrders.length / EXPORT_PREVIEW_PAGE))
  const pendingPageOrders = pendingOrders.slice(
    (pendingPage - 1) * EXPORT_PREVIEW_PAGE,
    pendingPage * EXPORT_PREVIEW_PAGE,
  )

  return (
    <div className="nm-hub-app nm-hub-app--logistica-andreani">
      <header className="dashboard-navbar dashboard-navbar-clean nm-hub-header">
        <HubBrandBar
          integratedDashboard
          integratedSubtitle="Logística Andreani"
          adminSignOut={adminSignOut}
        />
      </header>

      <HubDesktopNav role={profileRole} />

      <div className="logistica-page">
        <section className="logistica-page__head">
          <div>
            <h1 className="logistica-page__title">Centro de despacho Andreani</h1>
          </div>
          <button
            type="button"
            className="logistica-page__refresh"
            onClick={() => void refreshStatus()}
            disabled={loadingStatus}
          >
            {loadingStatus ? 'Actualizando…' : 'Actualizar'}
          </button>
        </section>

        {configHint && (
          <div className="logistica-alert logistica-alert--warn" role="alert">
            {configHint}
          </div>
        )}
        {apiOnline === false && !configHint && !statusError && (
          <div className="logistica-alert logistica-alert--warn" role="alert">
            Motor Andreani no responde. Revisá Railway y la variable VITE_ANDREANI_API_URL en Vercel.
          </div>
        )}
        {statusError && (
          <div className="logistica-alert logistica-alert--error" role="alert">
            {statusError}
          </div>
        )}

        <section className="logistica-metrics" aria-label="Resumen de envíos">
          <article className="logistica-metric">
            <p className="logistica-metric__label">Listos para crear etiqueta</p>
            <p className="logistica-metric__value logistica-metric__value--sky">
              {metrics.pending_export}
            </p>
            <p className="logistica-metric__desc">Pagados, sin tag ETIQUETA, listos para Excel</p>
          </article>
          <article className="logistica-metric">
            <p className="logistica-metric__label">Sin seguimiento</p>
            <p className="logistica-metric__value logistica-metric__value--violet">
              {metrics.missing_tracking}
            </p>
            <p className="logistica-metric__desc">
              Preparados en Shopify pero sin número de envío Andreani cargado
            </p>
          </article>
          <article className="logistica-metric">
            <p className="logistica-metric__label">Con error</p>
            <p className="logistica-metric__value logistica-metric__value--rose">
              {metrics.errors}
            </p>
            <p className="logistica-metric__desc">Dirección o CP inválidos — no entran al Excel</p>
          </article>
        </section>

        <section className="logistica-workspace">
          <div className="logistica-workspace__steps">
            <article className="logistica-panel">
              <h2 className="logistica-panel__title">Exportar etiquetas</h2>
              <p className="logistica-panel__text">Generá el excel para subir a Andreani</p>

              {pendingOrders.length > 0 ? (
                <div className="logistica-export-preview">
                  <p className="logistica-export-preview__title">
                    Listos para crear etiqueta ({pendingOrders.length})
                  </p>
                  <ul className="logistica-export-preview__list">
                    {pendingPageOrders.map((row) => (
                      <li key={row.order_id} className="logistica-export-preview__item">
                        <span className="logistica-export-preview__order">{row.order_name}</span>
                        <a
                          href={row.shopify_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="logistica-export-preview__link"
                        >
                          Ver en Shopify
                        </a>
                      </li>
                    ))}
                  </ul>
                  {pendingTotalPages > 1 ? (
                    <div className="logistica-export-preview__pagination">
                      <button
                        type="button"
                        className="logistica-export-preview__page-btn"
                        onClick={() => setPendingPage((page) => Math.max(1, page - 1))}
                        disabled={pendingPage <= 1}
                      >
                        Anterior
                      </button>
                      <span className="logistica-export-preview__page-info">
                        Página {pendingPage} de {pendingTotalPages}
                      </span>
                      <button
                        type="button"
                        className="logistica-export-preview__page-btn"
                        onClick={() =>
                          setPendingPage((page) => Math.min(pendingTotalPages, page + 1))
                        }
                        disabled={pendingPage >= pendingTotalPages}
                      >
                        Siguiente
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="logistica-export-preview__empty">No hay pedidos listos para exportar.</p>
              )}

              <button
                type="button"
                className="logistica-btn-primary logistica-panel__cta"
                onClick={startExport}
                disabled={exportRunning || apiOnline === false || Boolean(configHint)}
              >
                {exportRunning ? 'Generando…' : 'Generar carga masiva'}
              </button>

              {exportRunning ? (
                <div className="logistica-panel-progress" aria-label="Progreso de exportación">
                  <div className="logistica-progress__bar">
                    <div
                      className="logistica-progress__fill"
                      style={{ width: `${exportProgress}%` }}
                    />
                  </div>
                </div>
              ) : null}

              {exportFinished && exportLogs.length > 0 ? (
                <details className="logistica-logs-toggle">
                  <summary>Ver logs</summary>
                  <div className="logistica-console__body">{renderLogLines(exportLogs)}</div>
                </details>
              ) : null}
            </article>

            <article className="logistica-panel logistica-warnings-panel">
              <div className="logistica-held__head">
                <h2 className="logistica-panel__title">Etiquetas con warning</h2>
                <p className="logistica-panel__text">
                  Entran al Excel pero conviene revisar: dirección parseada, observaciones largas, etc.
                </p>
              </div>

              {warningOrders.length === 0 ? (
                <p className="logistica-held__empty">No hay pedidos con advertencias.</p>
              ) : (
                <>
                  <div className="logistica-held-cards">
                    {warningOrders.map((row) => (
                      <article key={row.order_id} className="logistica-held-card logistica-warn-card">
                        <div className="logistica-held-card__order">{row.order_name}</div>
                        <div className="logistica-held-card__customer">{row.customer || '—'}</div>
                        <ul className="logistica-warn-card__list">
                          {(row.warnings?.length ? row.warnings : [row.warning]).map((item) => (
                            <li key={item} className="logistica-warn-card__reason">
                              {item}
                            </li>
                          ))}
                        </ul>
                        <a
                          href={row.shopify_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="logistica-held-card__link"
                        >
                          Ver en Shopify
                        </a>
                      </article>
                    ))}
                  </div>

                  <table className="logistica-held-table logistica-warn-table">
                    <thead>
                      <tr>
                        <th>Pedido</th>
                        <th>Cliente</th>
                        <th>Warning</th>
                        <th>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {warningOrders.map((row) => (
                        <tr key={row.order_id}>
                          <td className="logistica-held-table__order">{row.order_name}</td>
                          <td>{row.customer || '—'}</td>
                          <td className="logistica-warn-table__reason">
                            <ul className="logistica-warn-table__list">
                              {(row.warnings?.length ? row.warnings : [row.warning]).map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </td>
                          <td>
                            <a
                              href={row.shopify_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="logistica-held-table__link"
                            >
                              Ver en Shopify
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </article>
          </div>
        </section>

        <section className="logistica-panel logistica-held">
          <div className="logistica-held__head">
            <h2 className="logistica-panel__title">Etiquetas con error</h2>
            <p className="logistica-panel__text">
              No entraron al Excel. Corregí en Shopify y volvé a exportar.
            </p>
          </div>

          {heldOrders.length === 0 ? (
            <p className="logistica-held__empty">No hay pedidos con errores de validación.</p>
          ) : (
            <>
              <div className="logistica-held-cards">
                {heldOrders.map((row) => (
                  <article key={row.order_id} className="logistica-held-card">
                    <div className="logistica-held-card__order">{row.order_name}</div>
                    <div className="logistica-held-card__customer">{row.customer || '—'}</div>
                    <div className="logistica-held-card__error">{row.error}</div>
                    <a
                      href={row.shopify_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="logistica-held-card__link"
                    >
                      Editar en Shopify
                    </a>
                  </article>
                ))}
              </div>

              <table className="logistica-held-table">
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Cliente</th>
                    <th>Error</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {heldOrders.map((row) => (
                    <tr key={row.order_id}>
                      <td className="logistica-held-table__order">{row.order_name}</td>
                      <td>{row.customer || '—'}</td>
                      <td className="logistica-held-table__error">{row.error}</td>
                      <td>
                        <a
                          href={row.shopify_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="logistica-held-table__link"
                        >
                          Editar en Shopify
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
