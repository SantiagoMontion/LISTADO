export type ShopifyCatalogStatus = 'active' | 'draft'
export type ShopifyProductStatus = ShopifyCatalogStatus | 'archived'

/**
 * El sync nunca escribe Active. Active lo pone Santiago a mano en Shopify.
 * Como mucho baja a draft un Active que quedó sin stock.
 * `null` = no escribir status.
 */
export function nextShopifyCatalogWrite(
  inStock: boolean,
  current: ShopifyProductStatus | null,
): ShopifyCatalogStatus | null {
  if (current === 'draft' || current === 'archived') return null
  if (inStock) return null
  if (current === 'active') return 'draft'
  return null
}

export function inStockFromQty(qty: number | null | undefined, inStock: boolean | null): boolean {
  if (inStock === true) return true
  if (inStock === false) return false
  const n = Number(qty)
  return Number.isFinite(n) && n >= 1
}
