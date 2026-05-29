/** Línea de material dentro de una tarea mayorista (mismo criterio que BORDES RECTOS). */
export type MayoristaLineMaterial = 'CLASSIC' | 'PRO'

export const MAYORISTA_LINE_MATERIAL_OPTIONS = ['Classic', 'PRO'] as const
export type MayoristaLineMaterialOption = (typeof MAYORISTA_LINE_MATERIAL_OPTIONS)[number]

export function mayoristaLineMaterialFromOption(
  option: MayoristaLineMaterialOption,
): MayoristaLineMaterial {
  return option === 'PRO' ? 'PRO' : 'CLASSIC'
}

/** Guarda medida + material en `dimensions`, p. ej. `44x22 - CLASSIC`. */
export function formatMayoristaDimensions(
  measure: string,
  lineMaterial: MayoristaLineMaterial,
): string {
  return `${measure.trim()} - ${lineMaterial}`
}

export function parseMayoristaDimensions(
  dimensions: string,
): { measure: string; lineMaterial: MayoristaLineMaterial } | null {
  const m = dimensions.trim().match(/^(\d+x\d+)\s*-\s*(CLASSIC|PRO)$/i)
  if (!m) return null
  const line = m[2].toUpperCase() as MayoristaLineMaterial
  if (line !== 'CLASSIC' && line !== 'PRO') return null
  return { measure: m[1], lineMaterial: line }
}
