import { describe, expect, it } from 'vitest'
import { extractReportDateIso, parseProductionReport } from './parseReport'

const SAMPLE_REPORT = `### REPORTE DE PRODUCCIÓN - 26/03/2026 ###

--------------------------------
LISTA CLASSIC
--------------------------------
25x25 - 6
55x54 - 2
60x25 - 1
60x30 - 1
70x20 - 1
70x33 - 1
80x35 - 1
80x40 - 1
82x32 - 4
90x40 - 11
115x55 - 1
120x50 - 1
140x47 - 1

--------------------------------
LISTA PRO
--------------------------------
25x25 - 1
35x35 - 1
50x30 - 1
50x40 - 5
60x31 - 1
60x50 - 1
65x30 - 1
70x30 - 2
82x32 - 1
90x40 - 5
100x45 - 1
100x50 - 1
116x45 - 1

--------------------------------
LISTA ALFOMBRAS
--------------------------------
Sin produccion.
`

describe('parseProductionReport', () => {
  it('extrae la fecha del título (26/03/2026 → ISO local)', () => {
    expect(extractReportDateIso(SAMPLE_REPORT)).toBe('2026-03-26')
    expect(parseProductionReport(SAMPLE_REPORT).fechaIso).toBe('2026-03-26')
  })

  it('parsea CLASSIC y PRO con todas las medidas', () => {
    const { sections } = parseProductionReport(SAMPLE_REPORT)
    const classic = sections.find((s) => s.materialType === 'classic')
    const pro = sections.find((s) => s.materialType === 'pro')
    expect(classic?.items.length).toBe(13)
    expect(pro?.items.length).toBe(13)
    expect(classic?.items.find((i) => i.dimensions === '25x25')?.totalQty).toBe(6)
    expect(pro?.items.find((i) => i.dimensions === '50x40')?.totalQty).toBe(5)
  })

  it('no incluye sección alfombras si solo hay "Sin produccion."', () => {
    const { sections } = parseProductionReport(SAMPLE_REPORT)
    expect(sections.some((s) => s.materialType === 'alfombras')).toBe(false)
  })

  it('acepta "Sin producción" con tilde', () => {
    const raw = `### REPORTE DE PRODUCCIÓN - 26/03/2026 ###
--------------------------------
LISTA ALFOMBRAS
--------------------------------
Sin producción
`
    const { sections } = parseProductionReport(raw)
    expect(sections.some((s) => s.materialType === 'alfombras')).toBe(false)
  })

  it('LISTA FALTAS sin líneas válidas no agrega secciones', () => {
    const raw = `### REPORTE DE PRODUCCIÓN - 26/03/2026 ###
--------------------------------
LISTA FALTAS
--------------------------------
Sin produccion.
`
    const { sections } = parseProductionReport(raw)
    expect(sections.length).toBe(0)
  })

  it('LISTA FALTAS enruta a Classic/Pro y marca prioridad', () => {
    const raw = `### REPORTE DE PRODUCCIÓN - 26/03/2026 ###
--------------------------------
LISTA FALTAS
--------------------------------
90x40 Classic - 2
50x40 Pro - 1
30x30 Alfombra - 1
`
    const { sections } = parseProductionReport(raw)
    const classic = sections.find((s) => s.materialType === 'classic')
    const pro = sections.find((s) => s.materialType === 'pro')
    const alf = sections.find((s) => s.materialType === 'alfombras')
    expect(classic?.items.find((i) => i.dimensions === '90x40')?.totalQty).toBe(2)
    expect(classic?.items.find((i) => i.dimensions === '90x40')?.is_priority).toBe(true)
    expect(pro?.items.find((i) => i.dimensions === '50x40')?.is_priority).toBe(true)
    expect(alf?.items.find((i) => i.dimensions === '30x30')?.is_priority).toBe(true)
  })

  it('LISTA FALTAS no fusiona cantidad con LISTA CLASSIC (dos filas 90x40)', () => {
    const raw = `### REPORTE DE PRODUCCIÓN - 26/03/2026 ###
--------------------------------
LISTA CLASSIC
--------------------------------
90x40 - 5
--------------------------------
LISTA FALTAS
--------------------------------
90x40 Classic - 2
`
    const { sections } = parseProductionReport(raw)
    const classic = sections.find((s) => s.materialType === 'classic')
    const rows90 = classic?.items.filter((i) => i.dimensions === '90x40') ?? []
    expect(rows90.length).toBe(2)
    const principal = rows90.find((i) => !i.from_faltas)
    const faltas = rows90.find((i) => i.from_faltas)
    expect(principal?.totalQty).toBe(5)
    expect(principal?.is_priority).toBeFalsy()
    expect(faltas?.totalQty).toBe(2)
    expect(faltas?.is_priority).toBe(true)
  })

  it('parsea BORDES RECTOS en sección separada y no lo mezcla con CLASSIC/PRO', () => {
    const raw = `### REPORTE DE PRODUCCIÓN - 23/04/2026 ###
--------------------------------
LISTA CLASSIC
--------------------------------
90x40 - 5
--------------------------------
LISTA PRO
--------------------------------
77x44 - 1
--------------------------------
BORDES RECTOS
--------------------------------
77x44 PRO - 1
90x40 Classic - 2
90x40 PRO - 1
100x60 Classic - 1
`
    const { sections } = parseProductionReport(raw)
    const classic = sections.find((s) => s.materialType === 'classic')
    const pro = sections.find((s) => s.materialType === 'pro')
    const bordes = sections.find((s) => s.materialType === 'bordes_rectos')

    expect(classic?.items.find((i) => i.dimensions === '90x40')?.totalQty).toBe(5)
    expect(pro?.items.find((i) => i.dimensions === '77x44')?.totalQty).toBe(1)

    expect(bordes?.items.length).toBe(4)
    expect(bordes?.items.find((i) => i.dimensions === '77x44 - PRO')?.totalQty).toBe(1)
    expect(bordes?.items.find((i) => i.dimensions === '90x40 - CLASSIC')?.totalQty).toBe(2)
    expect(bordes?.items.find((i) => i.dimensions === '90x40 - PRO')?.totalQty).toBe(1)
    expect(bordes?.items.find((i) => i.dimensions === '100x60 - CLASSIC')?.totalQty).toBe(1)

    const bordes90Classic = bordes?.items.find((i) => i.dimensions === '90x40 - CLASSIC')
    expect(bordes90Classic?.from_faltas).toBe(false)
    expect(bordes90Classic?.is_priority).toBeFalsy()
  })
})
