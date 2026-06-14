/** Extrae ancho × alto de una medida de tarea (`90x40`, `90x40 - CLASSIC`, etc.). */
export function parseTaskMeasure(dimensions: string): { ancho: number; alto: number } | null {
  const m = dimensions.trim().match(/^(\d+)\s*[xX×]\s*(\d+)/)
  if (!m) return null
  const ancho = Number(m[1])
  const alto = Number(m[2])
  if (!Number.isFinite(ancho) || !Number.isFinite(alto) || ancho <= 0 || alto <= 0) {
    return null
  }
  return { ancho, alto }
}
