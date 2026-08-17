import { getShopifyEnv } from '../importados-sync/env.js'
import { getSupabase } from '../importados-sync/supabase.js'

type ShopifyJson = Record<string, unknown>

type ShopifyProperty = {
  name?: string
  key?: string
  value?: string | number | null
}

type ShopifyLineItem = {
  id?: number | string
  title?: string
  name?: string
  sku?: string | null
  variant_title?: string | null
  quantity?: number
  fulfillable_quantity?: number
  fulfillment_status?: string | null
  product_id?: number | string | null
  properties?: ShopifyProperty[]
}

type ShopifyOrder = {
  id?: number | string
  name?: string
  created_at?: string
  financial_status?: string
  fulfillment_status?: string | null
  tags?: string
  note_attributes?: ShopifyProperty[]
  line_items?: ShopifyLineItem[]
}

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

type PrintRow = {
  id: string
  job_id: string | null
  bucket: string | null
  file_path: string | null
  file_name: string | null
  design_name: string | null
  created_at: string | null
}

const OUTPUT_BUCKET = 'outputs'
export const PAPEL_ORDER_TAG = 'Papel'

function adminBaseUrl(): string {
  const { domain, apiVersion } = getShopifyEnv()
  return `https://${domain}/admin/api/${apiVersion}`
}

async function shopifyFetch(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; json: ShopifyJson | null; text: string }> {
  const { token } = getShopifyEnv()
  const url = path.startsWith('http') ? path : `${adminBaseUrl()}/${path.replace(/^\//, '')}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)

  try {
    const resp = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
        ...(init.headers ?? {}),
      },
    })
    const text = await resp.text()
    let json: ShopifyJson | null = null
    try {
      json = text ? (JSON.parse(text) as ShopifyJson) : null
    } catch {
      json = null
    }
    return { ok: resp.ok, status: resp.status, json, text }
  } finally {
    clearTimeout(timer)
  }
}

function extractNumericId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value))
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const gidMatch = trimmed.match(/\/(\d+)\s*$/)
  if (gidMatch) return gidMatch[1]
  if (/^\d+$/.test(trimmed)) return trimmed
  return null
}

function normalizeString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return null
}

function readAttributeValue(
  entries: ShopifyProperty[] | undefined,
  keys: string[],
): string | null {
  if (!Array.isArray(entries)) return null
  const wanted = new Set(keys.map((key) => key.toLowerCase()))
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const name = normalizeString(entry.name) || normalizeString(entry.key)
    if (!name || !wanted.has(name.toLowerCase())) continue
    const value = normalizeString(entry.value)
    if (value) return value
  }
  return null
}

function lineStillNeedsFulfillment(line: ShopifyLineItem): number {
  if (typeof line.fulfillable_quantity === 'number') {
    return Math.max(0, Math.trunc(line.fulfillable_quantity))
  }
  if (line.fulfillment_status === 'fulfilled') return 0
  return Math.max(0, Math.trunc(line.quantity ?? 0))
}

function extractLineJobId(line: ShopifyLineItem, orderJobId: string | null): string | null {
  const fromLine = readAttributeValue(line.properties, ['job_id', 'jobid'])
  if (fromLine) return fromLine
  const sku = normalizeString(line.sku)
  // Los publishes nuevos guardan job_id en el SKU de la variante.
  if (sku && /^[a-z0-9_-]{8,64}$/i.test(sku)) return sku
  return orderJobId
}

function lineTitleOf(line: ShopifyLineItem): string {
  return (line.title || line.name || 'Producto').trim()
}

/** Hints del “código” de la línea Shopify (properties) para no adivinar el print. */
export type LineMatchHints = {
  material: string | null
  /** Ej. "90x32" parseado de "90x32 cm". */
  measurement: string | null
}

/** Tokens de versión (v2, v3…) que no deben ganar si el título de la orden no los trae. */
const VERSION_TOKEN_RE = /(?:^|[\s|_-])v(\d+)(?=$|[\s|_-])/i

export function parseMeasurementCm(raw: string | null | undefined): string | null {
  const text = String(raw || '').trim()
  if (!text) return null
  const match = text.match(/(\d+)\s*[x×]\s*(\d+)/i)
  if (!match) return null
  return `${match[1]}x${match[2]}`
}

export function extractLineMatchHints(line: ShopifyLineItem): LineMatchHints {
  const material = readAttributeValue(line.properties, ['material', 'Material'])
  const measurement = parseMeasurementCm(
    readAttributeValue(line.properties, [
      'measurement_cm',
      'measurement',
      'medida',
      'size',
      'dimensions',
    ]),
  )
  return {
    material: material ? material.trim() : null,
    measurement,
  }
}

export function designNameMatchesProductTitle(
  designName: string | null | undefined,
  productTitle: string,
): boolean {
  const name = typeof designName === 'string' ? designName.trim() : ''
  const trimmed = normalizeShopifyLineTitle(productTitle)
  if (!name || !trimmed) return false
  return (
    name === trimmed ||
    name.startsWith(`${trimmed} |`) ||
    name.startsWith(`${trimmed}|`)
  )
}

function versionTokensIn(text: string): string[] {
  const found: string[] = []
  const re = new RegExp(VERSION_TOKEN_RE.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    found.push(`v${m[1]}`.toLowerCase())
  }
  return found
}

/** true si el design agrega un vN que el título de la orden no tiene. */
export function designHasExtraVersionToken(
  designName: string | null | undefined,
  productTitle: string,
): boolean {
  const name = typeof designName === 'string' ? designName.trim() : ''
  if (!name) return false
  const titleTokens = new Set(versionTokensIn(normalizeShopifyLineTitle(productTitle)))
  return versionTokensIn(name).some((token) => !titleTokens.has(token))
}

function designContainsMaterial(designName: string, material: string): boolean {
  const name = designName.toLowerCase()
  const mat = material.trim().toLowerCase()
  if (!mat) return true
  // En design_name suele ir como “… 90x32 PRO | …”
  return new RegExp(`(?:^|[\\s|_-])${mat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s|_-])`, 'i').test(
    name,
  )
}

function designContainsMeasurement(designName: string, measurement: string): boolean {
  const name = designName.toLowerCase().replace(/\s+/g, '')
  const measure = measurement.toLowerCase().replace(/\s+/g, '')
  if (!measure) return true
  return name.includes(measure)
}

/**
 * Elige un print único usando título + properties de la orden (material/medida)
 * y rechazando “v2” (u otras versiones) que la orden no pide.
 * Nunca elige “el más nuevo” a ciegas.
 */
export function pickBestPrintMatch<T extends { design_name?: string | null }>(
  rows: T[],
  productTitle: string,
  hints: LineMatchHints = { material: null, measurement: null },
): { status: 'unique'; row: T } | { status: 'ambiguous'; count: number } | { status: 'none' } {
  const trimmed = normalizeShopifyLineTitle(productTitle)
  if (!trimmed || rows.length === 0) return { status: 'none' }

  let candidates = rows.filter((row) => designNameMatchesProductTitle(row.design_name, trimmed))

  // Si ninguno respeta el título exacto, no forzar match por prefix suelto.
  if (candidates.length === 0) return { status: 'none' }

  const withoutExtraVersion = candidates.filter(
    (row) => !designHasExtraVersionToken(row.design_name, trimmed),
  )
  if (withoutExtraVersion.length > 0) {
    candidates = withoutExtraVersion
  }

  if (hints.material) {
    const withMaterial = candidates.filter((row) =>
      designContainsMaterial(String(row.design_name || ''), hints.material!),
    )
    if (withMaterial.length > 0) candidates = withMaterial
  }

  if (hints.measurement) {
    const withMeasure = candidates.filter((row) =>
      designContainsMeasurement(String(row.design_name || ''), hints.measurement!),
    )
    if (withMeasure.length > 0) candidates = withMeasure
  }

  if (candidates.length === 1) return { status: 'unique', row: candidates[0] }
  if (candidates.length > 1) return { status: 'ambiguous', count: candidates.length }
  return { status: 'none' }
}

/** Personalizado: property _app_source=custom o título “… | Custom/NOTMID”. */
export function isPersonalizadosLine(line: ShopifyLineItem): boolean {
  const source = readAttributeValue(line.properties, ['_app_source', 'app_source'])
  if (source && source.toLowerCase() === 'custom') return true
  return /\|\s*(Custom|NOTMID)\b/i.test(lineTitleOf(line))
}

function escapeIlike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function orderHasPapelTag(order: ShopifyOrder): boolean {
  const needle = PAPEL_ORDER_TAG.toLowerCase()
  return parseTagList(order.tags).some((t) => t.toLowerCase() === needle)
}

async function fetchPaidUnfulfilledOrders(): Promise<ShopifyOrder[]> {
  const orders: ShopifyOrder[] = []

  for (const fulfillment of ['unfulfilled', 'partial']) {
    const { ok, status, json, text } = await shopifyFetch(
      // Sin `fields=` para no perder properties / note_attributes anidados.
      // Pagados + sin preparar (unfulfilled/partial). Luego excluimos tag «Papel».
      `orders.json?status=open&financial_status=paid&fulfillment_status=${fulfillment}&limit=100&order=created_at+desc`,
    )
    if (!ok) {
      if (status === 403 || status === 401) {
        throw new Error(
          `Shopify no autorizó leer pedidos (${status}). El token Admin necesita el scope read_orders.`,
        )
      }
      throw new Error(`Shopify orders failed (${status}): ${text.slice(0, 240)}`)
    }
    const batch = (json?.orders as ShopifyOrder[] | undefined) ?? []
    orders.push(...batch)
  }

  const seen = new Set<string>()
  return orders.filter((o) => {
    const id = extractNumericId(o.id)
    if (!id || seen.has(id)) return false
    if (orderHasPapelTag(o)) return false
    seen.add(id)
    return true
  })
}

function mapPrintRow(row: Record<string, unknown> | null | undefined): PrintRow | null {
  if (!row) return null
  return {
    id: String(row.id),
    job_id: typeof row.job_id === 'string' ? row.job_id : null,
    bucket: typeof row.bucket === 'string' ? row.bucket : null,
    file_path: typeof row.file_path === 'string' ? row.file_path : null,
    file_name: typeof row.file_name === 'string' ? row.file_name : null,
    design_name: typeof row.design_name === 'string' ? row.design_name : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : null,
  }
}

async function fetchPrintsByJobId(jobId: string): Promise<PrintRow[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('prints')
    .select('id, job_id, bucket, file_path, file_name, design_name, created_at')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    throw new Error(`Supabase prints lookup failed: ${error.message}`)
  }
  return (Array.isArray(data) ? data : [])
    .map((row) => mapPrintRow(row as Record<string, unknown>))
    .filter((row): row is PrintRow => Boolean(row))
}

/** Quita el sufijo “| Custom” / “| NOTMID” del título de línea de Shopify. */
export function normalizeShopifyLineTitle(title: string): string {
  return title.replace(/\s*\|\s*(Custom|NOTMID)\b/gi, '').trim()
}

/**
 * Match por título solo si hay exactamente 1 print compatible.
 * Delega a pickBestPrintMatch (título + material/medida + anti-v2).
 */
export function pickUniqueDesignNameMatch<T extends { design_name?: string | null }>(
  rows: T[],
  title: string,
  hints: LineMatchHints = { material: null, measurement: null },
): { status: 'unique'; row: T } | { status: 'ambiguous'; count: number } | { status: 'none' } {
  return pickBestPrintMatch(rows, title, hints)
}

type DesignTitleLookup =
  | { status: 'unique'; print: PrintRow }
  | { status: 'ambiguous'; count: number }
  | { status: 'none' }

async function fetchPrintByDesignTitle(
  title: string,
  hints: LineMatchHints = { material: null, measurement: null },
): Promise<DesignTitleLookup> {
  const trimmed = normalizeShopifyLineTitle(title)
  if (!trimmed) return { status: 'none' }
  const supabase = getSupabase()
  const pattern = `${escapeIlike(trimmed)}%`
  // Límite alto para detectar ambigüedad (no tomar el más reciente a ciegas).
  const { data, error } = await supabase
    .from('prints')
    .select('id, job_id, bucket, file_path, file_name, created_at, design_name')
    .ilike('design_name', pattern)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    throw new Error(`Supabase prints title lookup failed: ${error.message}`)
  }

  const picked = pickBestPrintMatch(Array.isArray(data) ? data : [], trimmed, hints)
  if (picked.status === 'unique') {
    const print = mapPrintRow(picked.row as Record<string, unknown>)
    return print ? { status: 'unique', print } : { status: 'none' }
  }
  if (picked.status === 'ambiguous') {
    return { status: 'ambiguous', count: picked.count }
  }
  return { status: 'none' }
}

async function assertPdfObjectExists(
  bucket: string,
  filePath: string,
): Promise<{ ok: boolean; reason: string | null }> {
  const path = filePath.replace(/^\/+/, '')
  if (!path) return { ok: false, reason: 'missing_file_path' }

  const supabase = getSupabase()
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60)
  if (error || !data?.signedUrl) {
    return { ok: false, reason: error?.message || 'object_not_found' }
  }
  return { ok: true, reason: null }
}

export async function listPendingPersonalizadosPdfs(): Promise<{
  rows: PersonalizadosPdfRow[]
  matched: number
  skipped: number
}> {
  const orders = await fetchPaidUnfulfilledOrders()
  const rows: PersonalizadosPdfRow[] = []
  type CachedPrint =
    | { kind: 'print'; print: PrintRow; method: 'job_id' | 'design_name' }
    | { kind: 'skip'; reason: string }
  const printCache = new Map<string, CachedPrint>()
  const existenceCache = new Map<string, { ok: boolean; reason: string | null }>()

  for (const order of orders) {
    const orderId = extractNumericId(order.id)
    if (!orderId) continue
    const orderName = (order.name || `#${orderId}`).trim()
    const orderJobId = readAttributeValue(order.note_attributes, ['job_id', 'jobid'])

    const openLines = (order.line_items ?? [])
      .map((line) => ({ line, qty: lineStillNeedsFulfillment(line) }))
      .filter((entry) => entry.qty > 0)

    // Solo listamos pedidos que tienen al menos un personalizado; dentro del pedido
    // incluimos TODAS las líneas abiertas (catálogo NotMid también) para no etiquetar
    // «Papel» mientras falte revisar alguna.
    if (!openLines.some(({ line }) => isPersonalizadosLine(line))) continue

    for (const { line, qty } of openLines) {
      const lineTitle = lineTitleOf(line)
      const lineItemId = extractNumericId(line.id) || `${orderId}-${lineTitle}`

      if (!isPersonalizadosLine(line)) {
        rows.push({
          orderId,
          orderName,
          createdAt: order.created_at || '',
          lineItemId,
          lineTitle,
          quantity: qty,
          jobId: null,
          matchMethod: 'design_name',
          status: 'skipped',
          printId: null,
          fileName: null,
          filePath: null,
          designName: null,
          reason: 'not_custom',
        })
        continue
      }

      const jobId = extractLineJobId(line, orderJobId)
      const hints = extractLineMatchHints(line)
      const titleKey = normalizeShopifyLineTitle(lineTitle).toLowerCase()
      const hintsKey = `m:${(hints.material || '').toLowerCase()}|s:${hints.measurement || ''}`
      const cacheKey = jobId
        ? `job:${jobId}|t:${titleKey}|${hintsKey}`
        : `title:${titleKey}|${hintsKey}`

      let resolved = printCache.get(cacheKey)
      if (!resolved) {
        if (jobId) {
          const byJobRows = await fetchPrintsByJobId(jobId)
          if (byJobRows.length === 1) {
            resolved = { kind: 'print', print: byJobRows[0], method: 'job_id' }
          } else if (byJobRows.length > 1) {
            // Mismo job_id con varios prints (ej. republish “v2”): desambiguar
            // con título + material/medida de la orden. Nunca el más nuevo a ciegas.
            const picked = pickBestPrintMatch(byJobRows, lineTitle, hints)
            if (picked.status === 'unique') {
              resolved = { kind: 'print', print: picked.row, method: 'job_id' }
            } else if (picked.status === 'ambiguous') {
              resolved = { kind: 'skip', reason: 'ambiguous_job_id' }
            } else {
              // job_id existe pero ningún print calza con el título/código → probar título
              const byTitle = await fetchPrintByDesignTitle(lineTitle, hints)
              if (byTitle.status === 'unique') {
                resolved = { kind: 'print', print: byTitle.print, method: 'design_name' }
              } else if (byTitle.status === 'ambiguous') {
                resolved = { kind: 'skip', reason: 'ambiguous_design_name' }
              } else {
                resolved = { kind: 'skip', reason: 'print_not_found' }
              }
            }
          } else {
            // job_id ausente en prints: título solo si es único (nunca adivinar)
            const byTitle = await fetchPrintByDesignTitle(lineTitle, hints)
            if (byTitle.status === 'unique') {
              resolved = { kind: 'print', print: byTitle.print, method: 'design_name' }
            } else if (byTitle.status === 'ambiguous') {
              resolved = { kind: 'skip', reason: 'ambiguous_design_name' }
            } else {
              resolved = { kind: 'skip', reason: 'print_not_found' }
            }
          }
        } else {
          const byTitle = await fetchPrintByDesignTitle(lineTitle, hints)
          if (byTitle.status === 'unique') {
            resolved = { kind: 'print', print: byTitle.print, method: 'design_name' }
          } else if (byTitle.status === 'ambiguous') {
            resolved = { kind: 'skip', reason: 'ambiguous_design_name' }
          } else {
            resolved = { kind: 'skip', reason: 'print_not_found' }
          }
        }
        printCache.set(cacheKey, resolved)
      }

      if (resolved.kind === 'skip') {
        rows.push({
          orderId,
          orderName,
          createdAt: order.created_at || '',
          lineItemId,
          lineTitle,
          quantity: qty,
          jobId,
          matchMethod: jobId ? 'job_id' : 'design_name',
          status: 'skipped',
          printId: null,
          fileName: null,
          filePath: null,
          designName: null,
          reason: resolved.reason,
        })
        continue
      }

      const print = resolved.print
      const matchMethod = resolved.method

      const bucket = (print.bucket || OUTPUT_BUCKET).trim() || OUTPUT_BUCKET
      const filePath = (print.file_path || '').trim()
      const existenceKey = `${bucket}::${filePath}`
      let existence = existenceCache.get(existenceKey)
      if (!existence) {
        existence = await assertPdfObjectExists(bucket, filePath)
        existenceCache.set(existenceKey, existence)
      }

      if (!existence.ok) {
        rows.push({
          orderId,
          orderName,
          createdAt: order.created_at || '',
          lineItemId,
          lineTitle,
          quantity: qty,
          jobId,
          matchMethod,
          status: 'skipped',
          printId: print.id,
          fileName: print.file_name,
          filePath,
          designName: print.design_name,
          reason: existence.reason || 'object_not_found',
        })
        continue
      }

      rows.push({
        orderId,
        orderName,
        createdAt: order.created_at || '',
        lineItemId,
        lineTitle,
        quantity: qty,
        jobId,
        matchMethod,
        status: 'matched',
        printId: print.id,
        fileName: print.file_name || filePath.split('/').pop() || null,
        filePath,
        designName: print.design_name,
        reason: null,
      })
    }
  }

  const matched = rows.filter((r) => r.status === 'matched').length
  const skipped = rows.filter((r) => r.status === 'skipped').length
  return { rows, matched, skipped }
}

export async function loadPrintPdfBuffer(printId: string): Promise<{
  buffer: ArrayBuffer
  fileName: string
  contentType: string
}> {
  const id = String(printId || '').trim()
  if (!id) throw new Error('printId_required')

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('prints')
    .select('id, bucket, file_path, file_name')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`Supabase prints fetch failed: ${error.message}`)
  if (!data) throw new Error('print_not_found')

  const bucket = (typeof data.bucket === 'string' && data.bucket.trim()) || OUTPUT_BUCKET
  const filePath = typeof data.file_path === 'string' ? data.file_path.trim() : ''
  if (!filePath) throw new Error('missing_file_path')

  const { data: blob, error: downloadError } = await supabase.storage
    .from(bucket)
    .download(filePath)

  if (downloadError || !blob) {
    throw new Error(downloadError?.message || 'object_not_found')
  }

  const buffer = await blob.arrayBuffer()
  const fileName =
    (typeof data.file_name === 'string' && data.file_name.trim()) ||
    filePath.split('/').filter(Boolean).pop() ||
    `${id}.pdf`

  return {
    buffer,
    fileName,
    contentType: 'application/pdf',
  }
}

function parseTagList(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

function mergePapelTag(existing: string[]): string {
  const lower = new Set(existing.map((t) => t.toLowerCase()))
  if (!lower.has(PAPEL_ORDER_TAG.toLowerCase())) {
    existing.push(PAPEL_ORDER_TAG)
  }
  return existing.join(', ')
}

/**
 * Pedidos completos = todas las líneas personalizadas del pedido están matched
 * y su printId está en downloadedPrintIds.
 * Parciales = al menos un matched descargado + al menos un skipped (o matched no descargado).
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
  const partial: Array<{ orderId: string; orderName: string; matched: number; skipped: number }> = []

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

export type TagPapelResult = {
  orderId: string
  orderName: string
  ok: boolean
  alreadyHadTag?: boolean
  error?: string
}

export async function tagOrdersWithPapel(
  orderIds: string[],
): Promise<{ tagged: TagPapelResult[]; taggedCount: number }> {
  const uniqueIds = [...new Set(orderIds.map((id) => String(id || '').trim()).filter(Boolean))]
  const tagged: TagPapelResult[] = []

  for (const orderId of uniqueIds) {
    try {
      const getResp = await shopifyFetch(`orders/${orderId}.json?fields=id,name,tags`)
      if (!getResp.ok || !getResp.json) {
        tagged.push({
          orderId,
          orderName: `#${orderId}`,
          ok: false,
          error: `Shopify GET failed (${getResp.status}): ${getResp.text.slice(0, 200)}`,
        })
        continue
      }

      const order = (getResp.json.order || {}) as {
        id?: number | string
        name?: string
        tags?: string
      }
      const orderName = (order.name || `#${orderId}`).trim()
      const existingTags = parseTagList(order.tags)
      const alreadyHadTag = existingTags.some(
        (t) => t.toLowerCase() === PAPEL_ORDER_TAG.toLowerCase(),
      )
      const nextTags = mergePapelTag([...existingTags])

      if (alreadyHadTag) {
        tagged.push({ orderId, orderName, ok: true, alreadyHadTag: true })
        continue
      }

      const putResp = await shopifyFetch(`orders/${orderId}.json`, {
        method: 'PUT',
        body: JSON.stringify({
          order: {
            id: Number(orderId),
            tags: nextTags,
          },
        }),
      })

      if (!putResp.ok) {
        tagged.push({
          orderId,
          orderName,
          ok: false,
          error: `Shopify PUT failed (${putResp.status}): ${putResp.text.slice(0, 200)}`,
        })
        continue
      }

      tagged.push({ orderId, orderName, ok: true, alreadyHadTag: false })
    } catch (error) {
      tagged.push({
        orderId,
        orderName: `#${orderId}`,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    tagged,
    taggedCount: tagged.filter((r) => r.ok).length,
  }
}
