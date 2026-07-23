export type LogisticsLogLevel = 'info' | 'success' | 'warning' | 'error'

export interface LogisticsEvent {
  type: 'log' | 'progress' | 'complete' | 'error'
  message: string
  level?: LogisticsLogLevel
  current?: number
  total?: number
  percent?: number
  data?: Record<string, unknown>
}

export interface LogisticsMetrics {
  pending_export: number
  missing_tracking: number
  errors: number
  warnings: number
}

export interface HeldOrder {
  order_name: string
  order_id: number
  customer: string
  error: string
  shopify_url: string
}

export interface WarningOrder {
  order_name: string
  order_id: number
  customer: string
  warnings: string[]
  warning: string
  shopify_url: string
}

export interface PendingExportOrder {
  order_name: string
  order_id: number
  customer: string
  shopify_url: string
}

export interface LogisticsStatusResponse {
  metrics: LogisticsMetrics
  held_orders: HeldOrder[]
  warning_orders: WarningOrder[]
  pending_orders: PendingExportOrder[]
  store_domain: string
}

export interface SendTrackingResult {
  order_name: string | null
  order_id: number | null
  customer: string
  status: string
  detail: string
  tracking: string
}

export interface SendTrackingJobSummary {
  id: string
  status: string
  created_at: string
  started_at?: string | null
  finished_at?: string | null
  ok_count?: number
  fail_count?: number
  processed_count?: number
  worker_id?: string | null
  results?: SendTrackingResult[]
  logs?: Array<{ id: number; ts: string; level: string; message: string }>
}

export interface SendTrackingJobListResponse {
  jobs: SendTrackingJobSummary[]
}

export interface LogisticsHealthResponse {
  status: string
  shopify_configured?: boolean
  shopify_ok?: boolean
  store?: string
  send_trackings_available?: boolean
  send_trackings_mode?: string
}

export class LogisticsApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LogisticsApiError'
  }
}

/**
 * URL del motor Andreani:
 * 1. VITE_ANDREANI_API_URL (build Vercel) → Railway directo — como funcionaba antes.
 * 2. Sin esa var en prod → proxy same-origin /api (Vercel serverless).
 * 3. Dev → proxy Vite → localhost:8765
 */
function apiBase(): string {
  const configured = (import.meta.env.VITE_ANDREANI_API_URL as string | undefined)?.trim()
  if (configured) return configured.replace(/\/$/, '')
  if (import.meta.env.DEV || import.meta.env.PROD) return ''
  return ''
}

function apiKey(): string {
  const directUrl = (import.meta.env.VITE_ANDREANI_API_URL as string | undefined)?.trim()
  if (directUrl) {
    return (import.meta.env.VITE_ANDREANI_API_KEY as string | undefined)?.trim() || ''
  }
  // Proxy Vercel inyecta la clave server-side
  if (import.meta.env.PROD) return ''
  return (import.meta.env.VITE_ANDREANI_API_KEY as string | undefined)?.trim() || ''
}

function assertApiConfigured(): void {
  // '' = same-origin /api (Vite proxy en DEV, Vercel serverless en PROD)
  if (apiBase() || import.meta.env.DEV || import.meta.env.PROD) return
  throw new LogisticsApiError(
    'Falta VITE_ANDREANI_API_URL en Vercel (URL de Railway) o ANDREANI_API_URL para el proxy. Redeploy.',
  )
}

function authQuery(): string {
  const key = apiKey()
  return key ? `api_key=${encodeURIComponent(key)}` : ''
}

function withAuth(url: string): string {
  const q = authQuery()
  if (!q) return url
  return url.includes('?') ? `${url}&${q}` : `${url}?${q}`
}

function headers(): HeadersInit {
  const key = apiKey()
  return key ? { 'X-Api-Key': key } : {}
}

function friendlyParseError(body: string, status: number): string {
  const trimmed = body.trim()
  if (trimmed.startsWith('<!') || trimmed.startsWith('<html')) {
    if (!apiBase() && !import.meta.env.DEV) {
      return 'NOT-BRAIN no está conectado a Railway. Configurá VITE_ANDREANI_API_URL en Vercel y redeploy.'
    }
    return `El servidor respondió con una página web (HTTP ${status}), no con datos JSON. Revisá la URL de Railway en Vercel.`
  }
  if (status === 401) {
    return 'Clave API incorrecta. VITE_ANDREANI_API_KEY en Vercel debe coincidir con ANDREANI_API_KEY en Railway.'
  }
  if (status === 502 && trimmed.includes('Shopify')) {
    return trimmed
  }
  if (status === 503) {
    return 'Motor Andreani sin token de Shopify. Revisá SHOPIFY_ADMIN_TOKEN en Railway.'
  }
  try {
    const json = JSON.parse(trimmed) as { detail?: string; message?: string }
    if (json.detail) return json.detail
    if (json.message) return json.message
  } catch {
    /* not json */
  }
  if (trimmed) return trimmed.slice(0, 240)
  return `Error del servidor (HTTP ${status})`
}

function isNetworkFailure(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false
  const msg = err.message.toLowerCase()
  return msg.includes('networkerror') || msg.includes('failed to fetch') || msg.includes('network')
}

function wrapFetchError(err: unknown): LogisticsApiError {
  if (err instanceof LogisticsApiError) return err
  if (isNetworkFailure(err)) {
    return new LogisticsApiError(
      'No se pudo conectar con Railway. Suele ser CORS, URL incorrecta o el servidor ocupado tras un export largo. ' +
        'Railway: NOTBRAIN_PUBLIC_URL = https://listado-seven.vercel.app . ' +
        'Vercel: VITE_ANDREANI_API_URL (sin barra final) y VITE_ANDREANI_API_KEY. ' +
        'Si el export terminó bien, probá Actualizar en unos segundos.',
    )
  }
  if (err instanceof Error) return new LogisticsApiError(err.message)
  return new LogisticsApiError('Error de red al contactar el motor Andreani.')
}

const FETCH_TIMEOUT_MS = 90_000

async function fetchApiJson<T>(path: string, init?: RequestInit): Promise<T> {
  assertApiConfigured()
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(withAuth(`${apiBase()}${path}`), {
      ...init,
      signal: controller.signal,
      headers: { ...headers(), ...(init?.headers ?? {}) },
    })
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new LogisticsApiError(
        'Railway tardó demasiado en responder (más de 90 s). Suele pasar tras un export largo o si el servidor está reiniciando. Probá Actualizar en unos segundos.',
      )
    }
    throw wrapFetchError(err)
  } finally {
    window.clearTimeout(timeoutId)
  }
  const body = await res.text()
  let data: T
  try {
    data = JSON.parse(body) as T
  } catch {
    throw new LogisticsApiError(friendlyParseError(body, res.status))
  }
  if (!res.ok) {
    const err = data as { detail?: string; message?: string }
    throw new LogisticsApiError(err.detail || err.message || friendlyParseError(body, res.status))
  }
  return data
}

export async function fetchLogisticsStatus(): Promise<LogisticsStatusResponse> {
  return fetchApiJson<LogisticsStatusResponse>('/api/logistics/status')
}

export async function checkLogisticsApiHealth(): Promise<boolean> {
  try {
    assertApiConfigured()
    const data = await fetchApiJson<LogisticsHealthResponse>('/api/health')
    return data.status === 'ok'
  } catch {
    return false
  }
}

export async function probeLogisticsApiHealth(): Promise<{
  ok: boolean
  error?: string
}> {
  try {
    assertApiConfigured()
    const data = await fetchApiJson<LogisticsHealthResponse>('/api/health')
    return { ok: data.status === 'ok' }
  } catch (err: unknown) {
    const message = err instanceof LogisticsApiError ? err.message : wrapFetchError(err).message
    return { ok: false, error: message }
  }
}

export function getLogisticsApiHint(): string | null {
  if (apiBase() || import.meta.env.DEV) return null
  return 'Configurá VITE_ANDREANI_API_URL en Vercel con la URL de Railway.'
}

function attachEventSourceStream(
  es: EventSource,
  onEvent: (event: LogisticsEvent) => void,
  interruptedMessage: string,
): void {
  let finished = false

  const finish = () => {
    finished = true
    es.close()
  }

  es.onmessage = (msg) => {
    try {
      const payload = JSON.parse(msg.data) as LogisticsEvent
      onEvent(payload)
      if (payload.type === 'complete' || payload.type === 'error') {
        finish()
      }
    } catch {
      onEvent({
        type: 'error',
        message: 'Respuesta inválida del servidor.',
        level: 'error',
      })
      finish()
    }
  }

  es.onerror = () => {
    if (finished) return
    onEvent({
      type: 'error',
      message: interruptedMessage,
      level: 'error',
    })
    finish()
  }
}

export function streamExport(
  options: { since?: string },
  onEvent: (event: LogisticsEvent) => void,
): { close: () => void } {
  assertApiConfigured()
  const params = new URLSearchParams()
  if (options.since) params.set('since', options.since)
  const key = apiKey()
  if (key) params.set('api_key', key)
  const qs = params.toString()
  const url = `${apiBase()}/api/logistics/export/stream${qs ? `?${qs}` : ''}`
  const es = new EventSource(url)

  attachEventSourceStream(
    es,
    onEvent,
    'Conexión interrumpida con Railway. Revisá que el servicio esté activo.',
  )

  return { close: () => es.close() }
}

export async function createSendTrackingJob(): Promise<{ job_id: string; status: string }> {
  return fetchApiJson<{ job_id: string; status: string }>('/api/logistics/send-trackings/jobs', {
    method: 'POST',
  })
}

export async function fetchSendTrackingJobs(): Promise<SendTrackingJobListResponse> {
  return fetchApiJson<SendTrackingJobListResponse>('/api/logistics/send-trackings/jobs')
}

export async function fetchSendTrackingJob(jobId: string): Promise<SendTrackingJobSummary> {
  return fetchApiJson<SendTrackingJobSummary>(`/api/logistics/send-trackings/jobs/${encodeURIComponent(jobId)}`)
}

export function streamSendTrackingJob(
  jobId: string,
  onEvent: (event: LogisticsEvent) => void,
): { close: () => void } {
  assertApiConfigured()
  const params = new URLSearchParams()
  const key = apiKey()
  if (key) params.set('api_key', key)
  const qs = params.toString()
  const url = `${apiBase()}/api/logistics/send-trackings/jobs/${encodeURIComponent(jobId)}/stream${qs ? `?${qs}` : ''}`
  const es = new EventSource(url)

  attachEventSourceStream(es, onEvent, 'Conexión interrumpida con Railway.')

  return { close: () => es.close() }
}

export function downloadExportUrl(filename: string): string {
  return withAuth(`${apiBase()}/api/logistics/download/${encodeURIComponent(filename)}`)
}

export async function downloadExportFile(filename: string): Promise<void> {
  assertApiConfigured()
  const url = downloadExportUrl(filename)

  // Preferir fetch+blob (nombre de archivo correcto). Si falla, navegación directa.
  try {
    const res = await fetch(url, { headers: headers() })
    if (!res.ok) {
      const body = await res.text()
      throw new LogisticsApiError(friendlyParseError(body, res.status))
    }
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    return
  } catch (err: unknown) {
    if (err instanceof LogisticsApiError) throw err
    // Fallback sin CORS (misma ventana)
    const a = document.createElement('a')
    a.href = url
    a.rel = 'noopener'
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
}

export function triggerDownload(filename: string): void {
  void downloadExportFile(filename)
}

export async function triggerDownloads(
  filenames: string[],
  onProgress?: (filename: string, index: number, total: number) => void,
): Promise<void> {
  const total = filenames.length
  for (let index = 0; index < total; index += 1) {
    const filename = filenames[index]
    onProgress?.(filename, index, total)
    await downloadExportFile(filename)
  }
}

export type ResolvedShopifyOrder = {
  order_id: number | string
  order_name: string
  shopify_url: string
}

/**
 * Resuelve nº de orden → URL directa admin (mismo link que «Ver en Shopify» en logística).
 * Usa el motor Andreani / Shopify ya configurado en Railway.
 */
export async function resolveShopifyOrderUrls(
  orderNumbers: string[],
): Promise<Record<string, ResolvedShopifyOrder>> {
  const unique = [
    ...new Set(
      orderNumbers
        .map((n) => n.trim().replace(/^#+/, ''))
        .filter(Boolean),
    ),
  ]
  if (unique.length === 0) return {}

  const qs = encodeURIComponent(unique.join(','))
  const data = await fetchApiJson<{ orders?: Record<string, ResolvedShopifyOrder> }>(
    `/api/shopify/order-urls?names=${qs}`,
  )
  return data.orders ?? {}
}
