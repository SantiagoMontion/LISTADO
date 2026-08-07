export type ProviderSnapshot = {
  price: number
  inStock: boolean
}

export type ProviderSuccess = {
  ok: true
  data: ProviderSnapshot
  warnings?: string[]
}

export type ProviderFailure = {
  ok: false
  error: string
}

export type ProviderResult = ProviderSuccess | ProviderFailure

export const FETCH_TIMEOUT_MS = 12_000

export const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Misma petición con reintentos ante rate-limit / errores temporales.
 * Lethal (Cloudflare) suele devolver 429 si el cron o varios creates pegan seguido.
 */
export async function fetchWithRetries(
  url: string,
  init: RequestInit = {},
  options: {
    timeoutMs?: number
    attempts?: number
    /** Esperas entre intentos (ms). Default: 2s, 5s, 12s */
    waitsMs?: number[]
  } = {},
): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? 4)
  const waits = options.waitsMs ?? [2000, 5000, 12000]
  let last: Response | null = null

  for (let i = 0; i < attempts; i += 1) {
    last = await fetchWithTimeout(url, init, options.timeoutMs)
    const retryable =
      last.status === 429 ||
      last.status === 503 ||
      last.status === 502 ||
      last.status === 408
    if (!retryable || i === attempts - 1) return last

    const retryAfterRaw = last.headers.get('retry-after')
    const retryAfterSec = retryAfterRaw ? Number(retryAfterRaw) : NaN
    const waitMs =
      Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? Math.min(Math.ceil(retryAfterSec * 1000), 20_000)
        : waits[Math.min(i, waits.length - 1)]
    await sleep(waitMs)
  }

  return last as Response
}

export function parsePrice(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw !== 'string') return null
  const cleaned = raw.replace(/[^0-9.,-]/g, '').trim()
  if (!cleaned) return null

  let normalized = cleaned
  if (cleaned.includes(',') && cleaned.includes('.')) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      normalized = cleaned.replace(/,/g, '')
    }
  } else if (cleaned.includes(',')) {
    normalized = cleaned.replace(',', '.')
  }

  const value = Number.parseFloat(normalized)
  return Number.isFinite(value) ? value : null
}

export function fail(error: unknown): ProviderFailure {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error)
  return { ok: false, error: message }
}
