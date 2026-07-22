/**
 * URL al admin de Shopify para buscar una orden por número/nombre.
 * Configurar VITE_SHOPIFY_STORE_HANDLE (ej. notmid) o VITE_SHOPIFY_STORE_DOMAIN (ej. notmid.myshopify.com).
 */
export function shopifyOrderAdminUrl(orderRaw: string): string | null {
  const order = orderRaw.trim().replace(/^#+/, '')
  if (!order) return null

  const handle = (import.meta.env.VITE_SHOPIFY_STORE_HANDLE ?? '').trim()
  const domain = (import.meta.env.VITE_SHOPIFY_STORE_DOMAIN ?? '').trim().replace(/^https?:\/\//, '')

  const query = encodeURIComponent(order.startsWith('#') ? order : order)

  if (handle) {
    return `https://admin.shopify.com/store/${handle}/orders?query=${query}`
  }

  if (domain) {
    const host = domain.replace(/\/$/, '')
    return `https://${host}/admin/orders?query=${query}`
  }

  return null
}

export function taskHasOrderNumber(task: {
  task_type?: string | null
  title?: string | null
}): boolean {
  if (task.task_type !== 'rehacer' && task.task_type !== 'devolucion') return false
  return Boolean((task.title ?? '').trim())
}
