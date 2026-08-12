import { getSupabase } from '../importados-sync/supabase.js'
import type { TrendSourceId } from './types.js'

function utcDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function getRemainingBudget(sourceId: TrendSourceId): Promise<number> {
  const sb = getSupabase()
  const { data: source } = await sb
    .from('trend_sources')
    .select('daily_budget, is_enabled')
    .eq('id', sourceId)
    .maybeSingle()

  if (!source || source.is_enabled === false) return 0
  const budget = Number(source.daily_budget) || 0

  const { data: usage } = await sb
    .from('trend_quota_usage')
    .select('used_count')
    .eq('source_id', sourceId)
    .eq('usage_date', utcDate())
    .maybeSingle()

  const used = Number(usage?.used_count) || 0
  return Math.max(0, budget - used)
}

export async function consumeBudget(sourceId: TrendSourceId, amount: number): Promise<boolean> {
  if (amount <= 0) return true
  const remaining = await getRemainingBudget(sourceId)
  if (remaining < amount) return false

  const sb = getSupabase()
  const day = utcDate()
  const { data: existing } = await sb
    .from('trend_quota_usage')
    .select('used_count')
    .eq('source_id', sourceId)
    .eq('usage_date', day)
    .maybeSingle()

  const used = (Number(existing?.used_count) || 0) + amount
  const { error } = await sb.from('trend_quota_usage').upsert(
    { source_id: sourceId, usage_date: day, used_count: used },
    { onConflict: 'source_id,usage_date' },
  )
  if (error) throw new Error(`quota upsert failed: ${error.message}`)
  return true
}
