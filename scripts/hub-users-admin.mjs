/**
 * Listar usuarios del hub y cambiar roles (requiere service_role).
 *
 *   $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."
 *   npm run hub:users
 *   npm run hub:set-role -- Dani admin
 *   npm run hub:set-role -- "spesia taller" admin
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const ROLE_LABEL = {
  admin: 'Admin',
  lista_creator: 'Papel',
  taller_1: 'Taller',
  taller_2: 'CORTE - BORDADO',
  online_1: 'Clientes',
  creador_lista: 'Papel (legacy)',
  operario: 'Taller (legacy)',
  vista: 'CORTE (legacy)',
}

const PERMS_SUMMARY = {
  admin: 'Todo (listas, corte, tareas, impresos, despachos, Andreani, analíticas)',
  lista_creator: 'Subir lista + tareas + dashboard',
  taller_1: 'Tareas, impresos, despachos (lectura), dashboard',
  online_1: 'Tareas + dashboard',
  taller_2: 'Solo lista de corte (editar)',
}

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
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY

const [, , command, ...rest] = process.argv

if (!url || !serviceKey) {
  console.error('Faltan VITE_SUPABASE_URL (.env) y SUPABASE_SERVICE_ROLE_KEY (entorno).')
  console.error('Dashboard → Settings → API → service_role (secreta).')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function listAllAuthUsers() {
  const users = []
  let page = 1
  const perPage = 200
  for (let i = 0; i < 50; i++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    users.push(...data.users)
    if (data.users.length < perPage) break
    page += 1
  }
  return users
}

async function listUsers() {
  const authUsers = await listAllAuthUsers()
  const { data: profiles, error } = await admin.from('nm_hub_profiles').select('id, display_name, role')
  if (error) throw error

  const byId = new Map((profiles ?? []).map((p) => [p.id, p]))

  const rows = authUsers.map((u) => {
    const p = byId.get(u.id)
    return {
      email: u.email ?? '',
      display_name: p?.display_name ?? '(sin perfil)',
      role: p?.role ?? '(sin rol)',
      id: u.id,
    }
  })

  rows.sort((a, b) => a.display_name.localeCompare(b.display_name, 'es'))

  console.log('\nUsuarios NOT-BRAIN (Auth + nm_hub_profiles)\n')
  console.log('Nombre'.padEnd(22), 'Email'.padEnd(32), 'Rol', 'Permisos resumidos')
  console.log('-'.repeat(100))

  for (const r of rows) {
    const label = ROLE_LABEL[r.role] ?? r.role
    const perms = PERMS_SUMMARY[r.role] ?? '—'
    console.log(
      r.display_name.slice(0, 21).padEnd(22),
      r.email.slice(0, 31).padEnd(32),
      label.padEnd(18),
      perms,
    )
  }

  console.log(`\nTotal: ${rows.length} usuario(s)\n`)
  return rows
}

async function findProfileByNeedle(needle) {
  const n = needle.trim().toLowerCase()
  const { data: profiles, error } = await admin.from('nm_hub_profiles').select('id, display_name, role')
  if (error) throw error

  const exact = (profiles ?? []).filter((p) => (p.display_name ?? '').trim().toLowerCase() === n)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) {
    throw new Error(`Varios perfiles con nombre exacto "${needle}"`)
  }

  const partial = (profiles ?? []).filter((p) => (p.display_name ?? '').trim().toLowerCase().includes(n))
  if (partial.length === 1) return partial[0]
  if (partial.length > 1) {
    const names = partial.map((p) => p.display_name).join(', ')
    throw new Error(`Varios perfiles coinciden con "${needle}": ${names}`)
  }

  const authUsers = await listAllAuthUsers()
  const byEmail = authUsers.filter((u) => (u.email ?? '').toLowerCase() === n)
  if (byEmail.length === 1) {
    const hit = (profiles ?? []).find((p) => p.id === byEmail[0].id)
    if (hit) return hit
  }

  return null
}

const VALID_ROLES = new Set(['admin', 'lista_creator', 'taller_1', 'taller_2', 'online_1'])

async function setRole(needle, newRole) {
  if (!VALID_ROLES.has(newRole)) {
    console.error(`Rol inválido: ${newRole}. Válidos: ${[...VALID_ROLES].join(', ')}`)
    process.exit(1)
  }

  const profile = await findProfileByNeedle(needle)
  if (!profile) {
    console.error(`No encontré usuario/perfil para: ${needle}`)
    process.exit(1)
  }

  if (profile.role === newRole) {
    console.log(`${profile.display_name} ya tiene rol ${newRole}.`)
    return
  }

  const { error } = await admin
    .from('nm_hub_profiles')
    .update({ role: newRole })
    .eq('id', profile.id)

  if (error) {
    console.error(error.message)
    process.exit(1)
  }

  const label = ROLE_LABEL[newRole] ?? newRole
  console.log(`OK: ${profile.display_name} → ${newRole} (${label})`)
  console.log('El usuario debe cerrar sesión y volver a entrar para ver el menú completo.')
}

async function promoteDefaults() {
  const targets = ['dani', 'spesia taller', 'spesia']
  for (const t of targets) {
    try {
      const profile = await findProfileByNeedle(t)
      if (!profile) continue
      if (profile.role === 'admin') {
        console.log(`Ya admin: ${profile.display_name}`)
        continue
      }
      await setRole(profile.display_name, 'admin')
    } catch (e) {
      console.warn(`Omitido "${t}": ${e.message}`)
    }
  }
}

try {
  if (!command || command === 'list') {
    await listUsers()
  } else if (command === 'set-role') {
    const [needle, role] = rest
    if (!needle || !role) {
      console.error('Uso: npm run hub:set-role -- "Nombre o email" admin')
      process.exit(1)
    }
    await setRole(needle, role.toLowerCase())
  } else if (command === 'promote-spesia-dani') {
    await promoteDefaults()
    await listUsers()
  } else {
    console.error('Comandos: list | set-role | promote-spesia-dani')
    process.exit(1)
  }
} catch (err) {
  console.error(err.message ?? err)
  process.exit(1)
}
