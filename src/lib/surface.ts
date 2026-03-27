/** Superficie para ordenar (mayor primero cuando se usa sort desc). */
export function surfaceFromDimensions(dimensions: string): number {
  const m = dimensions.trim().match(/^(\d+)\s*[xX×]\s*(\d+)$/)
  if (!m) return 0
  const w = Number(m[1])
  const h = Number(m[2])
  if (!Number.isFinite(w) || !Number.isFinite(h)) return 0
  return w * h
}
