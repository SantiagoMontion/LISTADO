export type Provider = 'lethal' | 'mk'

export function requireEnv(name: string): string {
  const value = (process.env[name] ?? '').trim()
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

export function firstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = (process.env[name] ?? '').trim()
    if (value) return value
  }
  return undefined
}

export function requireFirstEnv(names: string[]): string {
  const value = firstEnv(names)
  if (!value) throw new Error(`Missing required env var (one of): ${names.join(', ')}`)
  return value
}

export function getSupabaseEnv() {
  return {
    url: requireFirstEnv(['SUPABASE_URL', 'VITE_SUPABASE_URL']),
    serviceRoleKey: requireFirstEnv([
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_SERVICE_ROLE',
    ]),
  }
}

export function getShopifyEnv() {
  const domain = requireFirstEnv(['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_SHOP'])
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')

  return {
    domain,
    token: requireFirstEnv(['SHOPIFY_ADMIN_API_TOKEN', 'SHOPIFY_ADMIN_TOKEN']),
    apiVersion: (process.env.SHOPIFY_API_VERSION ?? '2024-10').trim() || '2024-10',
    locationId: firstEnv(['SHOPIFY_LOCATION_ID']),
  }
}

export function getCronSecret(): string {
  return requireEnv('CRON_SECRET')
}
