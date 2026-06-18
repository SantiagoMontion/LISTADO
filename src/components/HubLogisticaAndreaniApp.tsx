import { useCallback, useEffect, useRef, useState } from 'react'
import { HubBrandBar } from './HubBrandBar'
import { HubDesktopNav } from './HubDesktopNav'
import {
  createSendTrackingJob,
  fetchLogisticsStatus,
  fetchSendTrackingJobs,
  getLogisticsApiHint,
  probeLogisticsApiHealth,
  streamExport,
  streamSendTrackingJob,
  triggerDownload,
  type HeldOrder,
  type LogisticsEvent,
  type LogisticsLogLevel,
  type LogisticsMetrics,
  type SendTrackingJobSummary,
  type SendTrackingResult,
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
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  const [exportRunning, setExportRunning] = useState(false)
  const [exportFinished, setExportFinished] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportLogs, setExportLogs] = useState<LogLine[]>([])

  const [sendRunning, setSendRunning] = useState(false)
  const [sendFinished, setSendFinished] = useState(false)
  const [sendLogs, setSendLogs] = useState<LogLine[]>([])
  const [sendResults, setSendResults] = useState<SendTrackingResult[]>([])
  const [sendSummary, setSendSummary] = useState<{ ok: number; fail: number } | null>(null)
  const [jobHistory, setJobHistory] = useState<SendTrackingJobSummary[]>([])
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)

  const [sinceDate, setSinceDate] = useState('')
  const [showSinceDate, setShowSinceDate] = useState(false)

  const exportLogIdRef = useRef(0)
  const sendLogIdRef = useRef(0)
  const streamCloserRef = useRef<(() => void) | null>(null)

  const anyBusy = exportRunning || sendRunning

  const pushExportLog = useCallback((level: LogisticsLogLevel, message: string) => {
    exportLogIdRef.current += 1
    setExportLogs((prev) => [
      ...prev.slice(-400),
      { id: exportLogIdRef.current, level, message, ts: formatTime() },
    ])
  }, [])

  const pushSendLog = useCallback((level: LogisticsLogLevel, message: string) => {
    sendLogIdRef.current += 1
    setSendLogs((prev) => [
      ...prev.slice(-400),
      { id: sendLogIdRef.current, level, message, ts: formatTime() },
    ])
  }, [])

  const refreshStatus = useCallback(async () => {
    setLoadingStatus(true)
    setStatusError(null)
    try {
      if (configHint) {
        setApiOnline(false)
        setStatusError(configHint)
        return
      }
      const probe = await probeLogisticsApiHealth()
      setApiOnline(probe.ok)
      if (!probe.ok) {
        setStatusError(
          probe.error ||
            'No se pudo conectar con Railway. Revisá VITE_ANDREANI_API_URL y CORS en Railway.',
        )
        return
      }
      const [data, jobsData] = await Promise.all([
        fetchLogisticsStatus(),
        fetchSendTrackingJobs().catch(() => ({ jobs: [] })),
      ])
      setMetrics(data.metrics)
      setHeldOrders(data.held_orders)
      setJobHistory(jobsData.jobs)
    } catch (err: unknown) {
      setApiOnline(false)
      setStatusError(err instanceof Error ? err.message : 'Error al consultar estado')
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
        const summary = event.data?.summary as { filename?: string } | undefined
        const downloadName =
          (event.data?.download_name as string | undefined) || summary?.filename
        if (downloadName) {
          triggerDownload(downloadName)
          pushExportLog('success', `Descarga iniciada: ${downloadName}`)
        }
        setExportRunning(false)
        setExportFinished(true)
        void refreshStatus()
      } else if (event.type === 'error') {
        pushExportLog('error', event.message)
        setExportRunning(false)
        setExportFinished(true)
      }
    },
    [pushExportLog, refreshStatus],
  )

  const handleSendEvent = useCallback(
    (event: LogisticsEvent) => {
      if (event.type === 'log') {
        pushSendLog(event.level ?? 'info', event.message)
      } else if (event.type === 'complete') {
        pushSendLog(event.level ?? 'success', event.message)
        const job = event.data?.job as SendTrackingJobSummary | undefined
        if (job?.results) {
          setSendResults(job.results)
          setSendSummary({
            ok: job.ok_count ?? 0,
            fail: job.fail_count ?? 0,
          })
        }
        setSendRunning(false)
        setSendFinished(true)
        void refreshStatus()
      } else if (event.type === 'error') {
        pushSendLog('error', event.message)
        setSendRunning(false)
        setSendFinished(true)
      }
    },
    [pushSendLog, refreshStatus],
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
    if (anyBusy) return
    streamCloserRef.current?.()
    setExportRunning(true)
    setExportFinished(false)
    setExportProgress(0)
    setExportLogs([])
    exportLogIdRef.current = 0
    pushExportLog('info', 'Generando carga masiva Andreani…')
    const { close } = streamExport({ since: sinceDate || undefined }, handleExportEvent)
    streamCloserRef.current = close
  }

  const startSendTrackings = async () => {
    if (anyBusy) return
    streamCloserRef.current?.()
    setSendRunning(true)
    setSendFinished(false)
    setSendLogs([])
    setSendResults([])
    setSendSummary(null)
    sendLogIdRef.current = 0
    pushSendLog('info', 'Creando job en Railway…')
    try {
      const { job_id } = await createSendTrackingJob()
      pushSendLog(
        'info',
        'Job creado. Ejecutá send_trackings_worker.bat en la PC del taller o en tu casa.',
      )
      const { close } = streamSendTrackingJob(job_id, handleSendEvent)
      streamCloserRef.current = close
    } catch (err: unknown) {
      pushSendLog('error', err instanceof Error ? err.message : 'No se pudo crear el job')
      setSendRunning(false)
      setSendFinished(true)
    }
  }

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

        {sendRunning && (
          <div className="logistica-alert logistica-alert--info" role="status">
            Esperando worker en PC… Abrí <strong>scripts/send_trackings_worker.bat</strong> en el
            taller o en tu casa (solo mientras dure este envío).
          </div>
        )}

        <section className="logistica-metrics" aria-label="Resumen de envíos">
          <article className="logistica-metric">
            <p className="logistica-metric__label">Listos para crear etiqueta</p>
            <p className="logistica-metric__value logistica-metric__value--sky">
              {metrics.pending_export}
            </p>
            <p className="logistica-metric__desc">Pagados, sin enviar, sin etiqueta</p>
          </article>
          <article className="logistica-metric">
            <p className="logistica-metric__label">Sin seguimiento</p>
            <p className="logistica-metric__value logistica-metric__value--violet">
              {metrics.missing_tracking}
            </p>
            <p className="logistica-metric__desc">Pendientes de cargar en Shopify</p>
          </article>
          <article className="logistica-metric">
            <p className="logistica-metric__label">Con error</p>
            <p className="logistica-metric__value logistica-metric__value--rose">
              {metrics.errors}
            </p>
            <p className="logistica-metric__desc">Dirección, CP o sucursal</p>
          </article>
        </section>

        <section className="logistica-workspace">
          <div className="logistica-workspace__steps">
            <article className="logistica-panel">
              <h2 className="logistica-panel__title">Exportar etiquetas</h2>
              <p className="logistica-panel__text">Generá el excel para subir a Andreani</p>
              <label className="logistica-optional-toggle">
                <input
                  type="checkbox"
                  checked={showSinceDate}
                  onChange={(e) => {
                    const on = e.target.checked
                    setShowSinceDate(on)
                    if (!on) setSinceDate('')
                  }}
                />
                <span>Elegir fecha específica (OPCIONAL)</span>
              </label>
              {showSinceDate ? (
                <label className="logistica-field">
                  Solo pedidos desde
                  <input
                    type="date"
                    value={sinceDate}
                    onChange={(e) => setSinceDate(e.target.value)}
                    className="logistica-field__input"
                  />
                </label>
              ) : null}
              <button
                type="button"
                className="logistica-btn-primary"
                onClick={startExport}
                disabled={anyBusy || apiOnline === false || Boolean(configHint)}
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

            <article className="logistica-panel">
              <h2 className="logistica-panel__title">Enviar seguimientos</h2>
              <p className="logistica-panel__text">
                Fase 2: Shopify por API + Andreani headless. Mismo flujo en taller y en casa.
              </p>
              <ol className="logistica-steps-hint">
                <li>Ejecutá <code>send_trackings_worker.bat</code> en la PC donde estés</li>
                <li>Apretá el botón de abajo</li>
              </ol>
              <button
                type="button"
                className="logistica-btn-primary"
                onClick={() => void startSendTrackings()}
                disabled={anyBusy || apiOnline === false || Boolean(configHint)}
              >
                {sendRunning ? 'Enviando seguimientos…' : 'Mandar seguimientos'}
              </button>

              {sendSummary ? (
                <div className="logistica-send-summary">
                  <span className="logistica-send-summary__ok">{sendSummary.ok} OK</span>
                  <span className="logistica-send-summary__fail">{sendSummary.fail} fallidos</span>
                </div>
              ) : null}

              {sendResults.length > 0 ? (
                <ul className="logistica-send-results">
                  {sendResults.map((row) => (
                    <li
                      key={`${row.order_name}-${row.customer}-${row.status}`}
                      className={
                        row.status === 'ok'
                          ? 'logistica-send-results__item logistica-send-results__item--ok'
                          : 'logistica-send-results__item logistica-send-results__item--fail'
                      }
                    >
                      <span className="logistica-send-results__order">{row.order_name}</span>
                      <span className="logistica-send-results__customer">{row.customer}</span>
                      {row.status === 'ok' ? (
                        <span className="logistica-send-results__tracking">{row.tracking}</span>
                      ) : (
                        <span className="logistica-send-results__detail">{row.detail}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}

              {sendFinished && sendLogs.length > 0 ? (
                <details className="logistica-logs-toggle">
                  <summary>Ver logs</summary>
                  <div className="logistica-console__body">{renderLogLines(sendLogs)}</div>
                </details>
              ) : null}
            </article>
          </div>
        </section>

        {jobHistory.length > 0 ? (
          <section className="logistica-panel logistica-job-history">
            <h2 className="logistica-panel__title">Historial de envíos</h2>
            <ul className="logistica-job-history__list">
              {jobHistory.map((job) => (
                <li key={job.id} className="logistica-job-history__item">
                  <button
                    type="button"
                    className="logistica-job-history__head"
                    onClick={() =>
                      setExpandedJobId((prev) => (prev === job.id ? null : job.id))
                    }
                  >
                    <span>{new Date(job.created_at).toLocaleString('es-AR')}</span>
                    <span className={`logistica-job-history__status logistica-job-history__status--${job.status}`}>
                      {job.status}
                    </span>
                    <span>
                      {job.ok_count ?? 0} OK · {job.fail_count ?? 0} fallidos
                    </span>
                  </button>
                  {expandedJobId === job.id ? (
                    <p className="logistica-job-history__meta">
                      Worker: {job.worker_id || '—'}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

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
