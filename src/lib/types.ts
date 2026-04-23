export type MaterialTab = 'classic' | 'pro' | 'alfombras' | 'bordes_rectos' | 'otros'

export interface NmProdReport {
  id: string
  fecha: string
  created_at: string
}

export interface NmProdTask {
  id: string
  report_id: string
  material_type: string
  dimensions: string
  total_qty: number
  current_qty: number
  is_priority: boolean
  /** True = línea cargada solo desde LISTA FALTAS (no fusionar con lista principal). */
  from_faltas: boolean
  notes: string | null
  is_completed: boolean
  created_at: string
  updated_at?: string | null
}

export interface ParsedLineItem {
  dimensions: string
  totalQty: number
  width: number
  height: number
  /** True si viene de LISTA FALTAS (prioridad al subir). */
  is_priority?: boolean
  /** True = fila aparte en BD, no sumar con la misma medida de LISTA CLASSIC/PRO/… */
  from_faltas?: boolean
}

export interface ParsedSection {
  materialType: MaterialTab
  rawHeader: string
  items: ParsedLineItem[]
}
