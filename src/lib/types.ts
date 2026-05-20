import type { HubTaskAssignableRole } from './hubTaskAssignable'

export type MaterialTab = 'classic' | 'pro' | 'alfombras' | 'bordes_rectos' | 'otros'

export type { HubTaskAssignableRole } from './hubTaskAssignable'

export interface NmProdReport {
  id: string
  fecha: string
  created_at: string
}

/** Familia inferida del nombre de archivo (Classic1, PRO2, FALTAS1, …). */
export type NmProdMaterialFamily = 'classic' | 'pro' | 'ultra' | 'alfombra' | 'faltas'

export interface NmProdMaterialImageRow {
  id: string
  fecha: string
  material_family: NmProdMaterialFamily
  storage_path: string
  original_name: string | null
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

export type HubUserRole = 'admin' | 'lista_creator' | 'taller_1' | 'taller_2' | 'online_1'

/** Valor legacy en BD; se normaliza a lista_creator al leer el perfil. */
export type HubUserRoleLegacy = 'creador_lista'

export interface NmHubProfile {
  id: string
  display_name: string
  role: HubUserRole
  created_at: string
  updated_at: string
}

export type HubImportance = 'low' | 'normal' | 'high' | 'urgent'

export interface NmHubTaskNote {
  id: string
  task_id: string
  author_id: string
  body: string
  created_at: string
}

export interface NmHubTask {
  id: string
  title: string
  body: string | null
  importance: HubImportance
  /** Día calendario (YYYY-MM-DD) al que pertenece la tarea en el taller. */
  for_date?: string
  due_at: string | null
  executed_at: string | null
  /** Usuario que marcó como hecha (misma fila que executed_at). */
  executed_by: string | null
  image_paths: string[]
  created_by: string | null
  /** Usuario hub destino (Dani / JuanC / Spesia). Obligatorio en filas nuevas. */
  assigned_role: HubTaskAssignableRole
  /** Usuario asignado (UUID); opcional legacy. */
  assigned_to?: string | null
  created_at: string
  updated_at: string
}
