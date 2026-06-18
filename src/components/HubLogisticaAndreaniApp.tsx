import { useCallback, useEffect, useRef, useState } from 'react'
import { HubBrandBar } from './HubBrandBar'
import {
  checkLogisticsApiHealth,
  fetchLogisticsStatus,
  streamExport,
  streamImport,
  triggerDownload,
  type HeldOrder,
  type LogisticsEvent,
  type LogisticsLogLevel,
  type LogisticsMetrics,
} from '../lib/logisticaAndreaniApi'

interface HubLogisticaAndreaniAppProps {
  configured: boolean
  isAdmin: boolean
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

const LOG_COLORS: Record<LogisticsLogLevel, string> = {
  info: 'text-slate-300',
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  error: 'text-rose-400',
}

function formatTime(): string {
  return new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function MetricCard({
  label,
  value,
  accent,
  description,
}: {
  label: string
  value: number
  accent: string
  description: string
}) {
  return (
    <div className="rounded-xl border border-slate-700/80 bg-slate-900/60 p-4 shadow-lg backdrop-blur-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 font-mono text-3xl font-semibold tabular-nums ${accent}`}>{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">{description}</p>
    </div>
  )
}

export function HubLogisticaAndreaniApp({
  configured,
  adminSignOut = false,
}: HubLogisticaAndreaniAppProps) {
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
      const online = await checkLogisticsApiHealth()
      setApiOnline(online)
      if (!online) {
        setStatusError('API de logística no disponible. Ejecutá scripts/run_api.bat en NOT-ANDREANI.')
        return
      }
      const data = await fetchLogisticsStatus()
      setMetrics(data.metrics)
      setHeldOrders(data.held_orders)
    } catch (err: unknown) {
      setStatusError(err instanceof Error ? err.message : 'Error al consultar estado')
    } finally {
      setLoadingStatus(false)
    }
  }, [])

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
    <div className="nm-hub-app min-h-screen bg-slate-950 text-slate-100">
      <header className="dashboard-navbar border-b border-slate-800">
        <HubBrandBar
          integratedDashboard
          integratedSubtitle="Logística Andreani"
          adminSignOut={adminSignOut}
        />
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white">
                Centro de despacho Andreani
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                Exportá pedidos Shopify, subí resultados del portal y sincronizá trackings.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshStatus()}
              disabled={loadingStatus}
              className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-700 disabled:opacity-50"
            >
              {loadingStatus ? 'Actualizando…' : 'Actualizar panel'}
            </button>
          </div>

          {apiOnline === false && (
            <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              Servidor API offline. En la carpeta NOT-ANDREANI ejecutá:{' '}
              <code className="font-mono text-amber-100">python -m uvicorn api.main:app --port 8765</code>
            </div>
          )}
          {statusError && (
            <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {statusError}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard
              label="Pendientes export"
              value={metrics.pending_export}
              accent="text-sky-400"
              description="Pagados, sin enviar, sin etiqueta Andreani"
            />
            <MetricCard
              label="Listos despacho"
              value={metrics.ready_to_dispatch}
              accent="text-violet-400"
              description="Con tag ETIQUETA, pendientes de tracking"
            />
            <MetricCard
              label="En tránsito"
              value={metrics.in_transit}
              accent="text-cyan-400"
              description="Con número de seguimiento activo"
            />
            <MetricCard
              label="Entregados"
              value={metrics.delivered}
              accent="text-emerald-400"
              description="Entrega confirmada (últimos 45 días)"
            />
            <MetricCard
              label="Para revisar"
              value={metrics.errors}
              accent="text-rose-400"
              description="Validación de dirección, CP o sucursal"
            />
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-xl border border-slate-700/80 bg-slate-900/50 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                Paso 1 · Carga masiva
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                Genera el Excel para el portal Andreani PyMEs.
              </p>
              <label className="mt-4 block text-xs text-slate-500">
                Solo pedidos desde (opcional)
                <input
                  type="date"
                  value={sinceDate}
                  onChange={(e) => setSinceDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 font-mono text-sm text-slate-200"
                />
              </label>
              <button
                type="button"
                onClick={startExport}
                disabled={busy || apiOnline === false}
                className="mt-4 w-full rounded-lg bg-sky-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Generar carga masiva
              </button>
            </div>

            <div
              className={`rounded-xl border-2 border-dashed p-6 transition ${
                dragOver
                  ? 'border-sky-400 bg-sky-500/10'
                  : 'border-slate-600 bg-slate-900/50 hover:border-slate-500'
              }`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                Paso 2 · Resultados Andreani
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                Arrastrá el Excel de resultados del portal. Se importan trackings a Shopify
                automáticamente.
              </p>
              <p className="mt-4 text-center font-mono text-xs text-slate-600">
                .xlsx · arrastrar y soltar
              </p>
              <label className="mt-4 block">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void runImport(f)
                    e.target.value = ''
                  }}
                />
                <span className="flex cursor-pointer justify-center rounded-lg border border-slate-600 py-2 text-sm text-slate-300 hover:bg-slate-800">
                  O elegir archivo
                </span>
              </label>
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="rounded-xl border border-slate-700/80 bg-slate-900/50 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                  Progreso
                </h2>
                <span className="font-mono text-sm tabular-nums text-slate-400">{progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-400 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-2 min-h-[1.25rem] font-mono text-xs text-slate-500">{progressLabel}</p>

              <div className="mt-4 overflow-hidden rounded-lg border border-slate-800 bg-black/40">
                <div className="border-b border-slate-800 px-3 py-2 font-mono text-xs text-slate-500">
                  consola · live
                </div>
                <div className="h-72 overflow-y-auto p-3 font-mono text-xs leading-relaxed">
                  {logs.length === 0 && (
                    <p className="text-slate-600">Esperando tarea…</p>
                  )}
                  {logs.map((line) => (
                    <div key={line.id} className="flex gap-2">
                      <span className="shrink-0 text-slate-600">[{line.ts}]</span>
                      <span className={LOG_COLORS[line.level]}>{line.message}</span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-700/80 bg-slate-900/50 overflow-hidden">
          <div className="border-b border-slate-800 px-5 py-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Pedidos retenidos
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              No se incluyeron en el Excel. Corregí en Shopify y volvé a exportar.
            </p>
          </div>
          {heldOrders.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-600">
              No hay pedidos con errores de validación.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-800/50 text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Pedido</th>
                    <th className="px-5 py-3">Cliente</th>
                    <th className="px-5 py-3">Error</th>
                    <th className="px-5 py-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {heldOrders.map((row) => (
                    <tr key={row.order_id} className="hover:bg-slate-800/30">
                      <td className="px-5 py-3 font-mono text-sky-300">{row.order_name}</td>
                      <td className="px-5 py-3 text-slate-300">{row.customer || '—'}</td>
                      <td className="px-5 py-3 text-rose-300/90">{row.error}</td>
                      <td className="px-5 py-3 text-right">
                        <a
                          href={row.shopify_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
                        >
                          Editar en Shopify
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {!configured && (
          <p className="text-center text-xs text-slate-600">
            Hub sin Supabase — la logística Andreani usa el servidor API local.
          </p>
        )}
      </main>
    </div>
  )
}
