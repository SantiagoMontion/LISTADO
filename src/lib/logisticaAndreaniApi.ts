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

function apiBase(): string {
  const base = (import.meta.env.VITE_ANDREANI_API_URL as string | undefined)?.replace(/\/$/, '')
  return base || ''
}

function apiKey(): string {
  return (import.meta.env.VITE_ANDREANI_API_KEY as string | undefined) || ''
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

export async function fetchLogisticsStatus(): Promise<LogisticsStatusResponse> {
  const res = await fetch(withAuth(`${apiBase()}/api/logistics/status`), {
    headers: headers(),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(body || `Error ${res.status}`)
  }
  return res.json() as Promise<LogisticsStatusResponse>
}

export async function checkLogisticsApiHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase()}/api/health`)
    return res.ok
  } catch {
    return false
  }
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
      /* ignore */
    }
  }

  es.onerror = () => {
    onEvent({ type: 'error', message: 'Conexión SSE interrumpida', level: 'error' })
    es.close()
  }

  return { close: () => es.close() }
}

export async function streamImport(
  file: File,
  onEvent: (event: LogisticsEvent) => void,
): Promise<void> {
  const form = new FormData()
  form.append('file', file)
  const url = withAuth(`${apiBase()}/api/logistics/import/stream`)
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: form,
  })
  if (!res.ok || !res.body) {
    throw new Error(await res.text())
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
