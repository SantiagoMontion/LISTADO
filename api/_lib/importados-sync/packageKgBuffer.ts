/**
 * Margen de Aerobox sobre el peso de caja publicado.
 * 100 g en livianos, 150 g en 1–2.5 kg, 200 g en lo más pesado.
 * El flete extra lo cubre el precio; no se absorbe en margen.
 */

export function packageKgBufferGrams(packKg: number): number {
  const kg = Number(packKg)
  if (!Number.isFinite(kg) || kg <= 0) {
    throw new Error('Peso de caja inválido')
  }
  if (kg >= 2.5) return 200
  if (kg >= 1) return 150
  return 100
}

export function bufferedPackageKg(packKg: number): number {
  const extraKg = packageKgBufferGrams(packKg) / 1000
  return Math.round((Number(packKg) + extraKg) * 100) / 100
}
