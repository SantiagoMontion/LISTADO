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
  /** Nombre completo en prints.design_name (Supabase). */
  designName: string | null
  reason: string | null
}

export type PersonalizadosPdfsPendingResponse = {
  rows: PersonalizadosPdfRow[]
  matched: number
  skipped: number
  count: number
}

/**
 * Texto limpio para copiar: sin prefijo Mousepad/Glasspad/Alfombra
 * ni sufijo "| Custom".
 * Ej: "Mousepad SuperNegro 50x40 PRO | Custom" → "SuperNegro 50x40 PRO"
 */
export function copyablePersonalizadosTitle(raw: string): string {
  let text = String(raw || '').trim()
  if (!text) return ''

  text = text.replace(/\s*\|\s*(Custom|NOTMID)\b.*$/i, '').trim()
  text = text.replace(/^(Mousepad|Glasspad|Alfombra)\s+/i, '').trim()

  return text
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

export function personalizadosRowKey(row: PersonalizadosPdfRow): string {
  return `${row.orderId}-${row.lineItemId}-${row.jobId || row.printId || row.lineTitle}`
}

/**
 * Completo = todas las líneas del pedido OK (matched descargadas o OK manual).
 * Parcial = se avanzó algo, pero sigue habiendo pendientes.
 * «Papel» SOLO si no queda ninguna línea pendiente.
 */
export function partitionOrdersForPapelTag(
  rows: PersonalizadosPdfRow[],
  downloadedPrintIds: Iterable<string>,
  manualOkIds: Iterable<string> = [],
): {
  complete: Array<{ orderId: string; orderName: string }>
  partial: Array<{ orderId: string; orderName: string; matched: number; skipped: number }>
} {
  const downloaded = new Set(
    [...downloadedPrintIds].map((id) => String(id || '').trim()).filter(Boolean),
  )
  const manualOk = new Set(
    [...manualOkIds].map((id) => String(id || '').trim()).filter(Boolean),
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
    let readyCount = 0
    let pendingCount = 0
    let confirmedReady = 0

    for (const row of orderRows) {
      const key = personalizadosRowKey(row)
      const manual = manualOk.has(key)
      if (row.status === 'matched' && row.printId) {
        readyCount += 1
        if (downloaded.has(row.printId) || manual) confirmedReady += 1
      } else if (manual) {
        readyCount += 1
        confirmedReady += 1
      } else {
        pendingCount += 1
      }
    }

    if (readyCount > 0 && pendingCount === 0 && confirmedReady === readyCount) {
      complete.push({ orderId, orderName })
      continue
    }

    if (confirmedReady > 0 && pendingCount > 0) {
      partial.push({
        orderId,
        orderName,
        matched: confirmedReady,
        skipped: pendingCount,
      })
    }
  }

  return { complete, partial }
}

/** Identidad de producto dentro del pedido (iguales → una fila con ×N). */
export function productIdentityKey(row: PersonalizadosPdfRow): string {
  if (row.printId) return `print:${row.printId}`
  if (row.jobId) return `job:${row.jobId}`
  return `title:${row.lineTitle.trim().toLowerCase()}`
}

export type PersonalizadosProductGroup = {
  groupId: string
  orderId: string
  orderName: string
  lineTitle: string
  quantity: number
  status: PersonalizadosPdfRowStatus
  printId: string | null
  jobId: string | null
  fileName: string | null
  designName: string | null
  members: PersonalizadosPdfRow[]
}

/**
 * Une líneas idénticas del mismo pedido en un solo producto visual.
 * qty 1+1 → una fila ×2; un solo estado cubre todas las unidades.
 */
export function mergeIdenticalProductRows(
  rows: PersonalizadosPdfRow[],
): PersonalizadosProductGroup[] {
  const map = new Map<string, PersonalizadosProductGroup>()
  for (const row of rows) {
    const identity = productIdentityKey(row)
    const groupId = `${row.orderId}::${identity}`
    const existing = map.get(groupId)
    if (!existing) {
      map.set(groupId, {
        groupId,
        orderId: row.orderId,
        orderName: row.orderName,
        lineTitle: row.lineTitle,
        quantity: Math.max(1, Math.trunc(row.quantity || 1)),
        status: row.status,
        printId: row.printId,
        jobId: row.jobId,
        fileName: row.fileName,
        designName: row.designName,
        members: [row],
      })
      continue
    }
    existing.quantity += Math.max(1, Math.trunc(row.quantity || 1))
    existing.members.push(row)
    // Si alguna unidad sigue sin match, el grupo queda pendiente.
    if (row.status === 'skipped' || existing.status === 'skipped') {
      existing.status = 'skipped'
    }
    if (!existing.printId && row.printId) existing.printId = row.printId
    if (!existing.jobId && row.jobId) existing.jobId = row.jobId
    if (!existing.fileName && row.fileName) existing.fileName = row.fileName
    if (!existing.designName && row.designName) existing.designName = row.designName
  }
  return [...map.values()]
}

/**
 * Una entrada por unidad a imprimir: qty 2 → el mismo PDF va 2 veces al ZIP.
 * No dedupea por printId entre pedidos/líneas (cada unidad cuenta).
 */
export function expandMatchedRowsForZip(rows: PersonalizadosPdfRow[]): PersonalizadosPdfRow[] {
  const out: PersonalizadosPdfRow[] = []
  for (const row of rows) {
    if (row.status !== 'matched' || !row.printId) continue
    const copies = Math.max(1, Math.trunc(row.quantity || 1))
    for (let i = 0; i < copies; i += 1) {
      out.push(row)
    }
  }
  return out
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
