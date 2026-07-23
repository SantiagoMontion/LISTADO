/**
 * URL al admin de Shopify para buscar una orden por número.
 * Configurar VITE_SHOPIFY_STORE_HANDLE (ej. notmid) o VITE_SHOPIFY_STORE_DOMAIN.
 * Si no hay env, usa el handle Notmid por defecto.
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

/** Arma el link de admin usando solo el nº de orden parseado del título. */
export function shopifyOrderAdminUrl(orderRaw: string): string | null {
  const orderQuery = parseShopifyOrderNumberFromTitle(orderRaw)
  if (!orderQuery) return null

  const handle = (import.meta.env.VITE_SHOPIFY_STORE_HANDLE ?? '').trim()
  const domain = (import.meta.env.VITE_SHOPIFY_STORE_DOMAIN ?? '').trim().replace(/^https?:\/\//, '')

  // Shopify usa el nombre de orden con # (ej. #15704).
  const query = encodeURIComponent(`#${orderQuery}`)

  if (handle) {
    return `https://admin.shopify.com/store/${handle}/orders?query=${query}`
  }

  if (domain) {
    const host = domain.replace(/\/$/, '')
    return `https://${host}/admin/orders?query=${query}`
  }

  // Sin env (p. ej. Vercel sin variable), default Notmid para que el botón no quede muerto.
  return `https://admin.shopify.com/store/notmid/orders?query=${query}`
}

/** True si el título empieza con un nº de orden de 5 cifras (con o sin #). */
export function taskHasOrderNumber(task: {
  task_type?: string | null
  title?: string | null
}): boolean {
  return Boolean(parseShopifyOrderNumberFromTitle(task.title ?? ''))
}
