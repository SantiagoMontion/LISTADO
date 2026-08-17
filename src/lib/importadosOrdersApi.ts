import { supabase } from './supabase'
import type { ImportadosSaleLine } from './importadosSalesSummary'

export type ImportadosOrderLine = {
  lineItemId: string
  title: string
  variantTitle: string | null
  quantity: number
  supplierUrls: string[]
  provider: 'lethal' | 'mk' | null
  trackedProductId: string | null
  notmidVariantId: string | null
  supplierVariantId: string | null
  unmatchedVariant: boolean
}

export type ImportadosOrderRow = {
  orderId: string
  orderName: string
  createdAt: string
  financialStatus: string
  fulfillmentStatus: string | null
  adminUrl: string
  lines: ImportadosOrderLine[]
  allSupplierUrls: string[]
}

export type ImportadosSalesPayload = {
  lines: ImportadosSaleLine[]
  ingestError: string | null
  tableMissing: boolean
}

export type DisplayImportadosLine = ImportadosOrderLine & {
  memberIds: string[]
}

async function accessToken(): Promise<string> {
  if (!supabase) throw new Error('Supabase no está configurado')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error(error.message)
  const token = data.session?.access_token
  if (!token) throw new Error('Tenés que iniciar sesión')
  return token
}

export async function listImportadosOrders(): Promise<{
  orders: ImportadosOrderRow[]
  count: number
  units: number
}> {
  const token = await accessToken()
  const resp = await fetch('/api/importados-sync/orders', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })
  const json = (await resp.json().catch(() => ({}))) as {
    ok?: boolean
    error?: string
    orders?: ImportadosOrderRow[]
    count?: number
    units?: number
  }
  if (!resp.ok || json.ok === false) {
    throw new Error(json.error || `Error HTTP ${resp.status}`)
  }
  return {
    orders: json.orders ?? [],
    count: json.count ?? 0,
    units: json.units ?? 0,
  }
}

export async function fetchImportadosSales(): Promise<ImportadosSalesPayload> {
  const token = await accessToken()
  const resp = await fetch('/api/importados-sync/sales', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })
  const json = (await resp.json().catch(() => ({}))) as {
    ok?: boolean
    error?: string
    sales?: ImportadosSalesPayload
  }
  if (!resp.ok || json.ok === false) {
    throw new Error(json.error || `Error HTTP ${resp.status}`)
  }
  return json.sales ?? { lines: [], ingestError: null, tableMissing: false }
}

/** Une la misma variante (mismo proveedor + IDs) en una fila con ×N. */
export function mergeOrderLines(order: ImportadosOrderRow): DisplayImportadosLine[] {
  const map = new Map<string, DisplayImportadosLine>()
  for (const line of order.lines) {
    const identity = [
      line.trackedProductId || '',
      line.notmidVariantId || '',
      line.supplierVariantId || '',
      line.provider || 'notmid',
      line.title.trim().toLowerCase(),
      (line.variantTitle || '').trim().toLowerCase(),
    ].join('::')
    const existing = map.get(identity)
    if (!existing) {
      map.set(identity, {
        ...line,
        unmatchedVariant: Boolean(line.unmatchedVariant),
        memberIds: [line.lineItemId],
      })
      continue
    }
    existing.quantity += line.quantity
    existing.supplierUrls = [...existing.supplierUrls, ...line.supplierUrls]
    existing.unmatchedVariant = existing.unmatchedVariant || Boolean(line.unmatchedVariant)
    existing.memberIds.push(line.lineItemId)
  }
  return [...map.values()]
}

/**
 * Abre una pestaña por cada unidad. Tiene que correr en el mismo click del usuario
 * para que el navegador no bloquee los popups.
 */
export function openSupplierOrderTabs(urls: string[]): { opened: number; blocked: boolean } {
  let opened = 0
  let blocked = false
  for (const url of urls) {
    const win = window.open(url, '_blank', 'noopener,noreferrer')
    if (!win) {
      blocked = true
      continue
    }
    opened += 1
  }
  return { opened, blocked }
}
