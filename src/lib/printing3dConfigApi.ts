import {
  coercePrinting3DPrinterConfig,
  type Printing3DPrinterConfig,
} from './printing3dCalc'
import { supabase } from './supabase'

function requireClient() {
  if (!supabase) throw new Error('Supabase no configurado.')
  return supabase
}

export async function fetchPrinting3DPrinterConfig(): Promise<Printing3DPrinterConfig | null> {
  const sb = requireClient()
  const { data, error } = await sb
    .from('nm_hub_printing3d_config')
    .select('config')
    .eq('id', 1)
    .maybeSingle()

  if (error) throw error
  if (!data?.config || typeof data.config !== 'object') return null
  return coercePrinting3DPrinterConfig(data.config)
}

export async function savePrinting3DPrinterConfigRemote(
  config: Printing3DPrinterConfig,
  updatedBy?: string | null,
): Promise<void> {
  const sb = requireClient()
  const { error } = await sb.from('nm_hub_printing3d_config').upsert({
    id: 1,
    config,
    updated_by: updatedBy ?? null,
  })

  if (error) throw error
}
