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
