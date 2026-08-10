import { supabase } from './supabase'

export type PersonalizadosPdfRowStatus = 'matched' | 'skipped'

export type PersonalizadosPdfRow = {
  orderId: string
  orderName: string
  createdAt: string
  lineItemId: string
  lineTitle: string
  quantity: number
  jobId: string | null
  matchMethod: 'job_id' | 'design_name'
  status: PersonalizadosPdfRowStatus
  printId: string | null
  fileName: string | null
  filePath: string | null
  reason: string | null
}

export type PersonalizadosPdfsPendingResponse = {
  rows: PersonalizadosPdfRow[]
  matched: number
  skipped: number
  count: number
}

async function accessToken(): Promise<string> {
  if (!supabase) throw new Error('Supabase no está configurado')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error(error.message)
  const token = data.session?.access_token
  if (!token) throw new Error('Tenés que iniciar sesión')
  return token
}

export async function listPendingPersonalizadosPdfs(): Promise<PersonalizadosPdfsPendingResponse> {
  const token = await accessToken()
  const resp = await fetch('/api/personalizados-pdfs/pending', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })
  const json = (await resp.json().catch(() => ({}))) as {
    ok?: boolean
    error?: string
    rows?: PersonalizadosPdfRow[]
    matched?: number
    skipped?: number
    count?: number
  }
  if (!resp.ok || json.ok === false) {
    throw new Error(json.error || `Error HTTP ${resp.status}`)
  }
  return {
    rows: json.rows ?? [],
    matched: json.matched ?? 0,
    skipped: json.skipped ?? 0,
    count: json.count ?? 0,
  }
}

export async function fetchPersonalizadosPdfFile(
  printId: string,
): Promise<{ blob: Blob; fileName: string }> {
  const token = await accessToken()
  const params = new URLSearchParams({ printId })
  const resp = await fetch(`/api/personalizados-pdfs/file?${params.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/pdf,application/json',
    },
  })

  if (!resp.ok) {
    let message = `Error HTTP ${resp.status}`
    try {
      const json = (await resp.json()) as { error?: string }
      if (json.error) message = json.error
    } catch {
      // ignore
    }
    throw new Error(message)
  }

  const disposition = resp.headers.get('content-disposition') || ''
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i)
  const fileName = utfMatch
    ? decodeURIComponent(utfMatch[1])
    : plainMatch
      ? plainMatch[1]
      : `${printId}.pdf`

  const blob = await resp.blob()
  return { blob, fileName }
}

/**
 * Completo = todas las líneas del pedido matched y descargadas.
 * Parcial = se descargó al menos una, pero hay skipped u otras no descargadas.
 */
export function partitionOrdersForPapelTag(
  rows: PersonalizadosPdfRow[],
  downloadedPrintIds: Iterable<string>,
): {
  complete: Array<{ orderId: string; orderName: string }>
  partial: Array<{ orderId: string; orderName: string; matched: number; skipped: number }>
} {
  const downloaded = new Set(
    [...downloadedPrintIds].map((id) => String(id || '').trim()).filter(Boolean),
  )
  const byOrder = new Map<string, PersonalizadosPdfRow[]>()
  for (const row of rows) {
    const list = byOrder.get(row.orderId) || []
    list.push(row)
    byOrder.set(row.orderId, list)
  }

  const complete: Array<{ orderId: string; orderName: string }> = []
  const partial: Array<{ orderId: string; orderName: string; matched: number; skipped: number }> =
    []

  for (const [orderId, orderRows] of byOrder) {
    const orderName = orderRows[0]?.orderName || `#${orderId}`
    let matchedCount = 0
    let skippedCount = 0
    let downloadedMatched = 0

    for (const row of orderRows) {
      if (row.status === 'matched' && row.printId) {
        matchedCount += 1
        if (downloaded.has(row.printId)) downloadedMatched += 1
      } else {
        skippedCount += 1
      }
    }

    if (matchedCount > 0 && skippedCount === 0 && downloadedMatched === matchedCount) {
      complete.push({ orderId, orderName })
      continue
    }

    if (downloadedMatched > 0 && (skippedCount > 0 || downloadedMatched < matchedCount)) {
      partial.push({
        orderId,
        orderName,
        matched: downloadedMatched,
        skipped: skippedCount + (matchedCount - downloadedMatched),
      })
    }
  }

  return { complete, partial }
}

export async function tagOrdersWithPapel(orderIds: string[]): Promise<{
  taggedCount: number
  results: Array<{
    orderId: string
    orderName: string
    ok: boolean
    alreadyHadTag?: boolean
    error?: string
  }>
}> {
  const token = await accessToken()
  const resp = await fetch('/api/personalizados-pdfs/tag-papel', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ orderIds }),
  })
  const json = (await resp.json().catch(() => ({}))) as {
    ok?: boolean
    error?: string
    taggedCount?: number
    results?: Array<{
      orderId: string
      orderName: string
      ok: boolean
      alreadyHadTag?: boolean
      error?: string
    }>
  }
  if (!resp.ok && !json.taggedCount) {
    throw new Error(json.error || `Error HTTP ${resp.status}`)
  }
  return {
    taggedCount: json.taggedCount ?? 0,
    results: json.results ?? [],
  }
}
