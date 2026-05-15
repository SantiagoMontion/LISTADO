/**
 * Pone el nombre visible en Auth (user_metadata.full_name) y en public.nm_hub_profiles
 *
 * 1) Dashboard → Settings → API → copiá "service_role" (secreta, no la subas a Git).
 * 2) En PowerShell, desde la raíz del repo:
 *    $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."
 *    npm run auth:set-name -- tu@email.com "Juli"
 *
 * O en una sola línea (misma consola):
 *    $env:SUPABASE_SERVICE_ROLE_KEY="..."; npm run auth:set-name -- tu@email.com "Juli"
 *
 * Lee la URL desde .env (VITE_SUPABASE_URL o SUPABASE_URL).
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadDotEnv() {
  const p = join(__dirname, '..', '.env')
  if (!existsSync(p)) return {}
  const out = {}
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[k] = v
  }
  return out
}

const fileEnv = loadDotEnv()
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL || fileEnv.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY

const [, , email, fullName] = process.argv

if (!email || !fullName) {
  console.error('Uso: npm run auth:set-name -- email@dominio.com "Nombre visible"')
  process.exit(1)
}
if (!url) {
  console.error('Falta URL: definí VITE_SUPABASE_URL en .env o SUPABASE_URL en el entorno.')
  process.exit(1)
}
if (!serviceKey) {
  console.error(
    'Falta SUPABASE_SERVICE_ROLE_KEY (Settings → API → service_role). Exportala en la consola; no la pongas en .env que suba a Git.',
  )
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function findUserByEmail(target) {
  const want = target.trim().toLowerCase()
  let page = 1
  const perPage = 200
  for (let i = 0; i < 50; i++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const u = data.users.find((x) => (x.email ?? '').toLowerCase() === want)
    if (u) return u
    if (data.users.length < perPage) break
    page += 1
  }
  return null
}

const user = await findUserByEmail(email)
if (!user) {
  console.error(`No encontré usuario con email: ${email}`)
  process.exit(1)
}

const nextMeta = { ...(user.user_metadata ?? {}), full_name: fullName.trim() }
const { error } = await admin.auth.admin.updateUserById(user.id, { user_metadata: nextMeta })
if (error) {
  console.error(error.message)
  process.exit(1)
}

const { error: profileErr } = await admin
  .from('nm_hub_profiles')
  .update({ display_name: fullName.trim() })
  .eq('id', user.id)
if (profileErr) {
  console.warn('nm_hub_profiles:', profileErr.message, '(corré sql/nm_hub_profiles.sql si falta la tabla)')
} else {
  console.log('Tabla nm_hub_profiles: display_name actualizado.')
}

console.log(`Listo: ${email} → nombre visible "${fullName.trim()}" (metadata + perfil si aplica)`)
console.log('Cerrá sesión en la app y volvé a entrar para ver el saludo actualizado.')
