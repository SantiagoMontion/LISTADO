/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Clave pública VAPID (Web Push). Generar: npx web-push generate-vapid-keys */
  readonly VITE_VAPID_PUBLIC_KEY?: string
  /** API local de logística Andreani (NOT-ANDREANI). Vacío = proxy Vite /api */
  readonly VITE_ANDREANI_API_URL?: string
  readonly VITE_ANDREANI_API_KEY?: string
  /** Handle de la tienda en admin.shopify.com/store/{handle} */
  readonly VITE_SHOPIFY_STORE_HANDLE?: string
  /** Dominio myshopify.com alternativo (ej. notmid.myshopify.com) */
  readonly VITE_SHOPIFY_STORE_DOMAIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
