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
  ready_to_dispatch: number
  in_transit: number
  delivered: number
  errors: number
}

export interface HeldOrder {
  order_name: string
  order_id: number
  customer: string
  error: string
  shopify_url: string
}

export interface LogisticsStatusResponse {
  metrics: LogisticsMetrics
  held_orders: HeldOrder[]
  store_domain: string
}

export interface LogisticsHealthResponse {
  status: string
  shopify_configured?: boolean
  store?: string
}

export class LogisticsApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LogisticsApiError'
  }
}

function apiBase(): string {
  const configured = (import.meta.env.VITE_ANDREANI_API_URL as string | undefined)?.trim()
  if (configured) return configured.replace(/\/$/, '')
  if (import.meta.env.DEV) return ''
  return ''
}

function apiKey(): string {
  return (import.meta.env.VITE_ANDREANI_API_KEY as string | undefined)?.trim() || ''
}

function assertApiConfigured(): void {
  if (apiBase() || import.meta.env.DEV) return
  throw new LogisticsApiError(
    'Falta la URL del motor Andreani en Vercel. Agregá VITE_ANDREANI_API_URL (Railway), guardá y hacé Redeploy.',
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

async function fetchApiJson<T>(path: string, init?: RequestInit): Promise<T> {
  assertApiConfigured()
  const res = await fetch(withAuth(`${apiBase()}${path}`), {
    ...init,
    headers: { ...headers(), ...(init?.headers ?? {}) },
  })
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

export function getLogisticsApiHint(): string | null {
  if (apiBase() || import.meta.env.DEV) return null
  return 'Configurá VITE_ANDREANI_API_URL en Vercel con la URL de Railway.'
}

function parseSseChunk(buffer: string, onEvent: (event: LogisticsEvent) => void): string {
  const parts = buffer.split('\n\n')
  const rest = parts.pop() ?? ''
  for (const part of parts) {
    for (const line of part.split('\n')) {
      if (!line.startsWith('data: ')) continue
      try {
        const payload = JSON.parse(line.slice(6)) as LogisticsEvent
        onEvent(payload)
      } catch {
        /* ignore malformed */
      }
    }
  }
  return rest
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

  es.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as LogisticsEvent)
    } catch {
      onEvent({
        type: 'error',
        message: 'Respuesta inválida del servidor durante la exportación.',
        level: 'error',
      })
    }
  }

  es.onerror = () => {
    onEvent({
      type: 'error',
      message: 'Conexión interrumpida con Railway. Revisá que el servicio esté activo.',
      level: 'error',
    })
    es.close()
  }

  return { close: () => es.close() }
}

export async function streamImport(
  file: File,
  onEvent: (event: LogisticsEvent) => void,
): Promise<void> {
  assertApiConfigured()
  const form = new FormData()
  form.append('file', file)
  const url = withAuth(`${apiBase()}/api/logistics/import/stream`)
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: form,
  })
  if (!res.ok || !res.body) {
    const body = await res.text()
    throw new LogisticsApiError(friendlyParseError(body, res.status))
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    buffer = parseSseChunk(buffer, onEvent)
  }
  if (buffer.trim()) parseSseChunk(`${buffer}\n\n`, onEvent)
}

export function downloadExportUrl(filename: string): string {
  return withAuth(`${apiBase()}/api/logistics/download/${encodeURIComponent(filename)}`)
}

export function triggerDownload(filename: string): void {
  const a = document.createElement('a')
  a.href = downloadExportUrl(filename)
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
