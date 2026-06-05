import { normalizeCalendarDate } from './date'
import { supabase } from './supabase'
import type { NmProdMaterialFamily, NmProdMaterialImageRow } from './types'

export const NM_PROD_MATERIAL_IMAGE_BUCKET = 'nm-prod-material-images'

export const NM_PROD_MATERIAL_FAMILIES: NmProdMaterialFamily[] = ['classic', 'pro', 'ultra', 'alfombra', 'faltas']

export const NM_PROD_MATERIAL_FAMILY_LABEL: Record<NmProdMaterialFamily, string> = {
  classic: 'Classic',
  pro: 'PRO',
  ultra: 'Ultra',
  alfombra: 'Alfombra',
  faltas: 'Faltas',
}

function requireClient() {
  if (!supabase) throw new Error('Supabase no configurado.')
  return supabase
}

const MATERIAL_PREFIX_AT_START =
  /^(alfombra|classic|faltas|ultra|pro)(?:[\s._\-0-9]|$)/i

function materialKeywordInBasename(base: string, keyword: string): boolean {
  const esc = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[\\s._\\-])${esc}(?:[\\s._\\-0-9]|$)`, 'i').test(base)
}

const MATERIAL_KEYWORDS: { keyword: string; family: NmProdMaterialFamily }[] = [
  { keyword: 'faltas', family: 'faltas' },
  { keyword: 'alfombra', family: 'alfombra' },
  { keyword: 'classic', family: 'classic' },
  { keyword: 'ultra', family: 'ultra' },
  { keyword: 'pro', family: 'pro' },
]

/**
 * Interpreta el nombre de archivo (sin ruta): Classic1, 90x40 Classic, PRO_foto, etc.
 * Si no hay indicio de material, devuelve null (el modal puede asignar uno manualmente).
 */
export function parseMaterialFamilyFromFilename(filename: string): NmProdMaterialFamily | null {
  const base = filename.replace(/.*[/\\]/, '').replace(/\.[^.]+$/i, '').trim()
  if (!base) return null

  const atStart = base.match(MATERIAL_PREFIX_AT_START)
  if (atStart) return atStart[1].toLowerCase() as NmProdMaterialFamily

  for (const { keyword, family } of MATERIAL_KEYWORDS) {
    if (materialKeywordInBasename(base, keyword)) return family
  }
  return null
}

export async function fetchMaterialImagesByFecha(fecha: string): Promise<NmProdMaterialImageRow[]> {
  const sb = requireClient()
  const day = normalizeCalendarDate(fecha)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return []
  const { data, error } = await sb
    .from('nm_prod_material_images')
    .select('id, fecha, material_family, storage_path, original_name, created_at')
    .eq('fecha', day)
    .order('material_family', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as NmProdMaterialImageRow[]
}

export async function signedMaterialImageUrl(path: string, expiresSec = 60 * 45): Promise<string | null> {
  const map = await signedMaterialImageUrlsByPath([path], expiresSec)
  return map[path] ?? null
}

/** Una sola llamada para muchas rutas (más rápido que firmar una por una). */
export async function signedMaterialImageUrlsByPath(
  paths: string[],
  expiresSec = 60 * 45,
): Promise<Record<string, string>> {
  const sb = requireClient()
  const uniq = [...new Set(paths.filter(Boolean))]
  if (uniq.length === 0) return {}

  const { data, error } = await sb.storage
    .from(NM_PROD_MATERIAL_IMAGE_BUCKET)
    .createSignedUrls(uniq, expiresSec)

  if (error) throw error

  const out: Record<string, string> = {}
  for (const row of data ?? []) {
    const path = row?.path
    const url = row?.signedUrl
    if (path && url && !row?.error) out[path] = url
  }
  return out
}

export async function uploadMaterialDayImages(
  fecha: string,
  items: { file: File; family: NmProdMaterialFamily }[],
): Promise<void> {
  if (items.length === 0) return
  const sb = requireClient()
  const day = normalizeCalendarDate(fecha)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Fecha inválida.')

  for (const { file, family } of items) {
    const extMatch = file.name.match(/\.[a-z0-9]{1,8}$/i)
    const ext = extMatch ? extMatch[0] : ''
    const path = `${day}/${crypto.randomUUID()}${ext}`
    const { error: upErr } = await sb.storage.from(NM_PROD_MATERIAL_IMAGE_BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    })
    if (upErr) throw upErr

    const { error: insErr } = await sb.from('nm_prod_material_images').insert({
      fecha: day,
      material_family: family,
      storage_path: path,
      original_name: file.name,
    })
    if (insErr) throw insErr
  }
}
