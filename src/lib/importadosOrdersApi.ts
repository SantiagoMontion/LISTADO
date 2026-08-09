import { supabase } from './supabase'

export type ImportadosOrderLine = {
  lineItemId: string
  title: string
  variantTitle: string | null
  quantity: number
  supplierUrls: string[]
  provider: 'lethal' | 'mk'
  trackedProductId: string
  notmidVariantId: string | null
  supplierVariantId: string | null
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
