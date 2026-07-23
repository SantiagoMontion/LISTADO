/**
 * URL al admin de Shopify para buscar una orden por número.
 * Mismo store que NOT-ANDREANI: kw0f4u-ji.myshopify.com → handle kw0f4u-ji.
 *
 * Títulos de tareas suelen ser: "15000", "#15000", "15000 Juan", "#15704 rehacer borde".
 * Por ahora los nros de orden son de 5 cifras (~15000–16000).
 */

/** Extrae el nº de orden de 5 cifras al inicio del título (opcional # y frase después). */
export function parseShopifyOrderNumberFromTitle(title: string): string | null {
  const raw = (title ?? '').trim()
  if (!raw) return null

  // #15000 | # 15000 | 15000 | 15000 Juan | #15704 rehacer
  const match = raw.match(/^#?\s*(\d{5})(?!\d)/)
  if (!match) return null

  return match[1]
}

/** Handle admin.shopify.com/store/{slug} — igual que NOT-ANDREANI `shopify_admin_order_url`. */
function resolveShopifyStoreHandle(): string {
  const handle = (import.meta.env.VITE_SHOPIFY_STORE_HANDLE ?? '').trim()
  if (handle) return handle

  const domain = (import.meta.env.VITE_SHOPIFY_STORE_DOMAIN ?? '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
  if (domain) {
    const slug = domain.split('.')[0]?.trim()
    if (slug) return slug
  }

  // Default alineado con NOT-ANDREANI (SHOPIFY_STORE_DOMAIN=kw0f4u-ji.myshopify.com)
  return 'kw0f4u-ji'
}

/** Arma el link de admin usando solo el nº de orden parseado del título. */
export function shopifyOrderAdminUrl(orderRaw: string): string | null {
  const orderQuery = parseShopifyOrderNumberFromTitle(orderRaw)
  if (!orderQuery) return null

  const storeHandle = resolveShopifyStoreHandle()
  // Shopify usa el nombre de orden con # (ej. #15704).
  const query = encodeURIComponent(`#${orderQuery}`)
  return `https://admin.shopify.com/store/${storeHandle}/orders?query=${query}`
}

/** True si el título empieza con un nº de orden de 5 cifras (con o sin #). */
export function taskHasOrderNumber(task: {
  task_type?: string | null
  title?: string | null
}): boolean {
  return Boolean(parseShopifyOrderNumberFromTitle(task.title ?? ''))
}
