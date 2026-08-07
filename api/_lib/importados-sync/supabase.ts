import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseEnv, type Provider } from './env.js'

export type VariantMapEntry = {
  supplierVariantId: string
  option: string
  notmidVariantId: string
  sku: string | null
}

export type TrackedProduct = {
  id: string
  provider: Provider
  product_url: string
  shopify_handle: string | null
  notmid_shopify_variant_id: string | null
  notmid_shopify_product_id: string | null
  variant_map: VariantMapEntry[] | null
  current_price: number | null
  in_stock: boolean | null
  last_checked: string | null
  is_active: boolean
}

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (client) return client
  const { url, serviceRoleKey } = getSupabaseEnv()
  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return client
}

export async function fetchActiveTrackedProducts(): Promise<TrackedProduct[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('tracked_products')
    .select(
      'id, provider, product_url, shopify_handle, notmid_shopify_variant_id, notmid_shopify_product_id, variant_map, current_price, in_stock, last_checked, is_active',
    )
    .eq('is_active', true)

  if (error) {
    // Fallback if migration 003 not applied yet
    const fallback = await supabase
      .from('tracked_products')
      .select(
        'id, provider, product_url, shopify_handle, notmid_shopify_variant_id, current_price, in_stock, last_checked, is_active',
      )
      .eq('is_active', true)
    if (fallback.error) {
      throw new Error(`Supabase fetch tracked_products failed: ${error.message}`)
    }
    return (fallback.data ?? []).map((row) => ({
      ...row,
      notmid_shopify_product_id: null,
      variant_map: null,
      current_price:
        row.current_price === null || row.current_price === undefined
          ? null
          : Number(row.current_price),
    })) as TrackedProduct[]
  }

  return (data ?? []).map((row) => ({
    ...row,
    variant_map: Array.isArray(row.variant_map) ? row.variant_map : null,
    current_price:
      row.current_price === null || row.current_price === undefined
        ? null
        : Number(row.current_price),
  })) as TrackedProduct[]
}

export async function updateTrackedProduct(
  id: string,
  patch: {
    current_price?: number
    in_stock?: boolean
    last_checked: string
  },
): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase
    .from('tracked_products')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    throw new Error(`Supabase update tracked_products(${id}) failed: ${error.message}`)
  }
}
