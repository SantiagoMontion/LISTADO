import { describe, expect, it } from 'vitest'
import { parseMaterialFamilyFromFilename } from './nmProdMaterialImages'

describe('parseMaterialFamilyFromFilename', () => {
  it('reconoce prefijo al inicio con número o sufijo libre', () => {
    expect(parseMaterialFamilyFromFilename('Classic1.png')).toBe('classic')
    expect(parseMaterialFamilyFromFilename('classic_90x40.jpg')).toBe('classic')
    expect(parseMaterialFamilyFromFilename('PRO-2.jpeg')).toBe('pro')
    expect(parseMaterialFamilyFromFilename('FALTAS1.webp')).toBe('faltas')
    expect(parseMaterialFamilyFromFilename('ultra10.png')).toBe('ultra')
    expect(parseMaterialFamilyFromFilename('Alfombra_3.png')).toBe('alfombra')
  })

  it('reconoce el material en cualquier parte del nombre', () => {
    expect(parseMaterialFamilyFromFilename('90x40 Classic.jpg')).toBe('classic')
    expect(parseMaterialFamilyFromFilename('diseño PRO borde.png')).toBe('pro')
    expect(parseMaterialFamilyFromFilename('IMG_faltas_lunes.png')).toBe('faltas')
  })

  it('devuelve null si no hay indicio de material', () => {
    expect(parseMaterialFamilyFromFilename('foto_001.png')).toBe(null)
    expect(parseMaterialFamilyFromFilename('proyecto_final.png')).toBe(null)
  })
})
