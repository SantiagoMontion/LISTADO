import { useCallback, useEffect, useRef, useState } from 'react'
import { HubBrandBar } from './HubBrandBar'
import { HubDesktopNav } from './HubDesktopNav'
import {
  fetchLogisticsStatus,
  getLogisticsApiHint,
  probeLogisticsApiHealth,
  streamExport,
  streamImport,
  triggerDownload,
  type HeldOrder,
  type LogisticsEvent,
  type LogisticsLogLevel,
  type LogisticsMetrics,
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
  ready_to_dispatch: 0,
  in_transit: 0,
  delivered: 0,
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

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [logs, setLogs] = useState<LogLine[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [sinceDate, setSinceDate] = useState('')

  const logIdRef = useRef(0)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const streamCloserRef = useRef<(() => void) | null>(null)

  const pushLog = useCallback((level: LogisticsLogLevel, message: string) => {
    logIdRef.current += 1
    setLogs((prev) => [
      ...prev.slice(-400),
      { id: logIdRef.current, level, message, ts: formatTime() },
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
      const data = await fetchLogisticsStatus()
      setMetrics(data.metrics)
      setHeldOrders(data.held_orders)
    } catch (err: unknown) {
      setApiOnline(false)
      setStatusError(err instanceof Error ? err.message : 'Error al consultar estado')
    } finally {
      setLoadingStatus(false)
    }
  }, [configHint])

  const handleEvent = useCallback(
    (event: LogisticsEvent) => {
      if (event.type === 'log') {
        pushLog(event.level ?? 'info', event.message)
      } else if (event.type === 'progress') {
        setProgress(event.percent ?? 0)
        setProgressLabel(event.message)
        pushLog('info', event.message)
      } else if (event.type === 'complete') {
        setProgress(100)
        setProgressLabel(event.message)
        pushLog('success', event.message)
        const summary = event.data?.summary as { filename?: string } | undefined
        const downloadName =
          (event.data?.download_name as string | undefined) || summary?.filename
        if (downloadName) {
          triggerDownload(downloadName)
          pushLog('success', `Descarga iniciada: ${downloadName}`)
        }
        setBusy(false)
        void refreshStatus()
      } else if (event.type === 'error') {
        pushLog('error', event.message)
        setBusy(false)
      }
    },
    [pushLog, refreshStatus],
  )

  useEffect(() => {
    void refreshStatus()
    const interval = window.setInterval(() => void refreshStatus(), 60_000)
    return () => {
      window.clearInterval(interval)
      streamCloserRef.current?.()
    }
  }, [refreshStatus])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const startExport = () => {
    if (busy) return
    streamCloserRef.current?.()
    setBusy(true)
    setProgress(0)
    setProgressLabel('Iniciando exportación…')
    setLogs([])
    pushLog('info', 'Generando carga masiva Andreani…')
    const { close } = streamExport({ since: sinceDate || undefined }, handleEvent)
    streamCloserRef.current = close
  }

  const runImport = async (file: File) => {
    if (busy) return
    setBusy(true)
    setProgress(0)
    setProgressLabel('Importando trackings…')
    pushLog('info', `Archivo recibido: ${file.name}`)
    try {
      await streamImport(file, handleEvent)
    } catch (err: unknown) {
      pushLog('error', err instanceof Error ? err.message : 'Error en importación')
      setBusy(false)
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) void runImport(file)
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
            <p className="logistica-page__subtitle">
              Exportá pedidos de Shopify, subí resultados del portal y sincronizá trackings.
            </p>
          </div>
          <button
            type="button"
            className="logistica-page__refresh"
            onClick={() => void refreshStatus()}
            disabled={loadingStatus}
          >
            {loadingStatus ? 'Actualizando…' : 'Actualizar panel'}
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
            <p className="logistica-metric__label">Pendientes export</p>
            <p className="logistica-metric__value logistica-metric__value--sky">
              {metrics.pending_export}
            </p>
            <p className="logistica-metric__desc">Pagados, sin enviar, sin etiqueta</p>
          </article>
          <article className="logistica-metric">
            <p className="logistica-metric__label">Listos despacho</p>
            <p className="logistica-metric__value logistica-metric__value--violet">
              {metrics.ready_to_dispatch}
            </p>
            <p className="logistica-metric__desc">Con tag ETIQUETA, sin tracking</p>
          </article>
          <article className="logistica-metric">
            <p className="logistica-metric__label">En tránsito</p>
            <p className="logistica-metric__value logistica-metric__value--cyan">
              {metrics.in_transit}
            </p>
            <p className="logistica-metric__desc">Seguimiento activo</p>
          </article>
          <article className="logistica-metric">
            <p className="logistica-metric__label">Entregados</p>
            <p className="logistica-metric__value logistica-metric__value--green">
              {metrics.delivered}
            </p>
            <p className="logistica-metric__desc">Últimos 45 días</p>
          </article>
          <article className="logistica-metric">
            <p className="logistica-metric__label">Para revisar</p>
            <p className="logistica-metric__value logistica-metric__value--rose">
              {metrics.errors}
            </p>
            <p className="logistica-metric__desc">Dirección, CP o sucursal</p>
          </article>
        </section>

        <section className="logistica-workspace">
          <div className="logistica-workspace__steps">
            <article className="logistica-panel">
              <h2 className="logistica-panel__title">Paso 1 · Carga masiva</h2>
              <p className="logistica-panel__text">Genera el Excel para el portal Andreani PyMEs.</p>
              <label className="logistica-field">
                Solo pedidos desde (opcional)
                <input
                  type="date"
                  value={sinceDate}
                  onChange={(e) => setSinceDate(e.target.value)}
                  className="logistica-field__input"
                />
              </label>
              <button
                type="button"
                className="logistica-btn-primary"
                onClick={startExport}
                disabled={busy || apiOnline === false || Boolean(configHint)}
              >
                Generar carga masiva
              </button>
            </article>

            <article
              className={`logistica-dropzone ${dragOver ? 'logistica-dropzone--active' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <h2 className="logistica-panel__title">Paso 2 · Resultados Andreani</h2>
              <p className="logistica-panel__text">
                Arrastrá el Excel de resultados del portal. Se importan los trackings a Shopify.
              </p>
              <p className="logistica-dropzone__hint">.xlsx · arrastrar y soltar</p>
              <label className="logistica-file-btn">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  hidden
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void runImport(f)
                    e.target.value = ''
                  }}
                />
                O elegir archivo
              </label>
            </article>
          </div>

          <article className="logistica-panel">
            <div className="logistica-progress__head">
              <h2 className="logistica-panel__title">Progreso</h2>
              <span className="logistica-progress__pct">{progress}%</span>
            </div>
            <div className="logistica-progress__bar">
              <div className="logistica-progress__fill" style={{ width: `${progress}%` }} />
            </div>
            <p className="logistica-progress__label">{progressLabel}</p>

            <div className="logistica-console">
              <div className="logistica-console__head">consola · live</div>
              <div className="logistica-console__body">
                {logs.length === 0 && (
                  <p className="logistica-console__msg--info">Esperando tarea…</p>
                )}
                {logs.map((line) => (
                  <div key={line.id} className="logistica-console__line">
                    <span className="logistica-console__ts">[{line.ts}]</span>
                    <span className={LOG_CLASS[line.level]}>{line.message}</span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>
          </article>
        </section>

        <section className="logistica-panel logistica-held">
          <div className="logistica-held__head">
            <h2 className="logistica-panel__title">Pedidos retenidos</h2>
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
