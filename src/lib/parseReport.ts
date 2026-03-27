import type { MaterialTab, ParsedLineItem, ParsedSection } from './types'

/** Encabezado tipo `### REPORTE DE PRODUCCIÓN - 26/03/2026 ###` (los `#` son opcionales para el match). */
const REPORT_DATE_RE =
  /REPORTE\s+DE\s+PRODUCCI[OÓ]N\s*[-–]\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i
const DIM_LINE_RE = /^(\d+)\s*[xX×]\s*(\d+)\s*[-–]\s*(\d+)\s*$/
const SEPARATOR_RE = /^[-─=]{3,}\s*$/
/** Bloque sin piezas: `Sin produccion.` / `Sin producción` (se ignora, no es error). */
const NO_PRODUCTION_LINE_RE = /^sin\s+producci[oó]n\.?\s*$/i

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Devuelve YYYY-MM-DD o null si no hay fecha en el encabezado. */
export function extractReportDateIso(text: string): string | null {
  const m = text.match(REPORT_DATE_RE)
  if (!m) return null
  const d = Number(m[1])
  const mo = Number(m[2])
  const y = Number(m[3])
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${y}-${pad2(mo)}-${pad2(d)}`
}

function normalizeMaterial(header: string): MaterialTab {
  const cleaned = header
    .trim()
    .toUpperCase()
    .replace(/^LISTA\s+/, '')
    .replace(/\s+/g, ' ')

  if (cleaned.includes('CLASSIC')) return 'classic'
  if (cleaned === 'PRO' || cleaned.startsWith('PRO ')) return 'pro'
  if (cleaned.includes('ALFOMBRA')) return 'alfombras'
  return 'otros'
}

function parseDimensionLine(line: string): ParsedLineItem | null {
  const m = line.trim().match(DIM_LINE_RE)
  if (!m) return null
  const width = Number(m[1])
  const height = Number(m[2])
  const totalQty = Number(m[3])
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(totalQty)) {
    return null
  }
  if (width <= 0 || height <= 0 || totalQty <= 0) return null
  return {
    dimensions: `${width}x${height}`,
    totalQty,
    width,
    height,
  }
}

/** Suma cantidades si la misma medida aparece más de una vez en el bloque. */
function mergeItemsByDimension(items: ParsedLineItem[]): ParsedLineItem[] {
  const map = new Map<string, ParsedLineItem>()
  for (const it of items) {
    const cur = map.get(it.dimensions)
    if (!cur) {
      map.set(it.dimensions, { ...it })
    } else {
      cur.totalQty += it.totalQty
    }
  }
  return [...map.values()]
}

/**
 * Transforma el texto del reporte en secciones por material.
 * No escribe en base de datos.
 */
export function parseProductionReport(raw: string): {
  fechaIso: string | null
  sections: ParsedSection[]
} {
  const fechaIso = extractReportDateIso(raw)
  const lines = raw.split(/\r?\n/)
  const byMaterial = new Map<MaterialTab, ParsedLineItem[]>()
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!SEPARATOR_RE.test(line)) {
      i += 1
      continue
    }

    i += 1
    while (i < lines.length && lines[i].trim() === '') i += 1
    if (i >= lines.length) break

    const header = lines[i]
    i += 1

    while (i < lines.length && lines[i].trim() === '') i += 1
    if (i >= lines.length || !SEPARATOR_RE.test(lines[i])) {
      continue
    }
    i += 1

    const blockItems: ParsedLineItem[] = []
    while (i < lines.length) {
      const l = lines[i]
      if (SEPARATOR_RE.test(l)) break
      if (l.trim() === '') {
        i += 1
        continue
      }
      const trimmed = l.trim()
      if (NO_PRODUCTION_LINE_RE.test(trimmed)) {
        i += 1
        continue
      }
      const parsed = parseDimensionLine(l)
      if (parsed) blockItems.push(parsed)
      i += 1
    }

    if (blockItems.length === 0) continue
    const materialType = normalizeMaterial(header)
    const acc = byMaterial.get(materialType) ?? []
    acc.push(...blockItems)
    byMaterial.set(materialType, acc)
  }

  const tabOrder: MaterialTab[] = ['classic', 'pro', 'alfombras', 'otros']
  const sections: ParsedSection[] = []
  for (const materialType of tabOrder) {
    const items = byMaterial.get(materialType)
    if (!items?.length) continue
    sections.push({
      materialType,
      rawHeader: materialType,
      items: mergeItemsByDimension(items),
    })
  }

  return { fechaIso, sections }
}
