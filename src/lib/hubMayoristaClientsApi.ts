import { supabase } from './supabase'
import type { NmHubMayoristaClient } from './types'

function requireClient() {
  if (!supabase) throw new Error('Supabase no configurado.')
  return supabase
}

function coerceClient(row: Record<string, unknown>): NmHubMayoristaClient {
  return {
    id: String(row.id),
    full_name: String(row.full_name ?? ''),
    dni: String(row.dni ?? ''),
    phone: String(row.phone ?? ''),
    email: String(row.email ?? ''),
    address: String(row.address ?? ''),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }
}

/** Solo dígitos; quita prefijo 549 o 54 si está presente. */
export function normalizeMayoristaPhone(raw: string): string {
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('549')) digits = digits.slice(3)
  else if (digits.startsWith('54')) digits = digits.slice(2)
  return digits
}

export function normalizeMayoristaClientName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

export type MayoristaClientInput = {
  full_name: string
  dni: string
  phone: string
  email: string
  address: string
}

function prepareClientPayload(input: MayoristaClientInput) {
  return {
    full_name: normalizeMayoristaClientName(input.full_name),
    dni: input.dni.trim(),
    phone: normalizeMayoristaPhone(input.phone),
    email: input.email.trim(),
    address: input.address.trim(),
  }
}

export async function fetchMayoristaClients(): Promise<NmHubMayoristaClient[]> {
  const sb = requireClient()
  const { data, error } = await sb
    .from('nm_hub_mayorista_clients')
    .select('*')
    .order('full_name', { ascending: true })

  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map(coerceClient)
}

export async function searchMayoristaClientsByName(query: string): Promise<NmHubMayoristaClient[]> {
  const q = normalizeMayoristaClientName(query)
  if (!q) return fetchMayoristaClients()

  const sb = requireClient()
  const { data, error } = await sb
    .from('nm_hub_mayorista_clients')
    .select('*')
    .ilike('full_name', `%${q.replace(/[%_]/g, '\\$&')}%`)
    .order('full_name', { ascending: true })
    .limit(12)

  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map(coerceClient)
}

export async function findMayoristaClientByName(
  fullName: string,
): Promise<NmHubMayoristaClient | null> {
  const name = normalizeMayoristaClientName(fullName)
  if (!name) return null

  const sb = requireClient()
  const { data, error } = await sb
    .from('nm_hub_mayorista_clients')
    .select('*')
    .ilike('full_name', name)
    .limit(5)

  if (error) throw error
  const rows = ((data ?? []) as Record<string, unknown>[]).map(coerceClient)
  const exact = rows.find((r) => r.full_name.trim().toLowerCase() === name.toLowerCase())
  return exact ?? null
}

export async function upsertMayoristaClient(input: MayoristaClientInput): Promise<NmHubMayoristaClient> {
  const payload = prepareClientPayload(input)
  if (!payload.full_name) throw new Error('El nombre del cliente es obligatorio.')

  const existing = await findMayoristaClientByName(payload.full_name)
  const sb = requireClient()

  if (existing) {
    const { data, error } = await sb
      .from('nm_hub_mayorista_clients')
      .update(payload)
      .eq('id', existing.id)
      .select('*')
      .single()

    if (error) throw error
    return coerceClient(data as Record<string, unknown>)
  }

  const { data, error } = await sb
    .from('nm_hub_mayorista_clients')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new Error('Ya existe un cliente con ese nombre.')
    }
    throw error
  }

  return coerceClient(data as Record<string, unknown>)
}

export function formatMayoristaClientBlock(client: MayoristaClientInput): string {
  const c = prepareClientPayload(client)
  return [
    '---',
    `Cliente: ${c.full_name}`,
    `DNI: ${c.dni}`,
    `Tel: ${c.phone}`,
    `Email: ${c.email}`,
    `Dirección: ${c.address}`,
  ].join('\n')
}

export function appendClientToTaskBody(description: string, client: MayoristaClientInput): string {
  const desc = description.trim()
  const block = formatMayoristaClientBlock(client)
  return desc ? `${desc}\n\n${block}` : block
}
