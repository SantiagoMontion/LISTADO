import type { User } from '@supabase/supabase-js'

/** Nombre legible para UI: metadata del usuario en Auth (ej. `full_name` al crear/editar en el dashboard). */
export function displayNameFromAuthUser(user: User | null | undefined): string {
  if (!user) return ''
  const m = user.user_metadata as Record<string, unknown> | null | undefined
  const pick = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const fromMeta =
    pick(m?.full_name) ||
    pick(m?.name) ||
    pick(m?.display_name) ||
    pick(m?.given_name) ||
    pick(m?.preferred_username)
  if (fromMeta) return fromMeta
  const local = user.email?.split('@')[0]?.trim()
  return local ?? ''
}
