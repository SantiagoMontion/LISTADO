export type MaterialTab = 'classic' | 'pro' | 'alfombras' | 'otros'

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
}

export interface ParsedSection {
  materialType: MaterialTab
  rawHeader: string
  items: ParsedLineItem[]
}
