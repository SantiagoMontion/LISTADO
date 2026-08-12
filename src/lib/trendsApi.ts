import { supabase } from './supabase'
import { formatHttpApiError, formatSupabaseOrError } from './errors'

export type TrendSearchGoal = 'both' | 'product' | 'content'

export type TrendTaskConfig = {
  context: string
  goal: TrendSearchGoal
  keywords: string[]
  must_include: string[]
  exclude: string[]
  news_queries: string[]
  subreddits: string[]
  youtube_channel_ids: string[]
  rss_feeds: string[]
  trends_geos: string[]
  bluesky_queries: string[]
  sources_enabled: string[]
}

export type TrendSearchTask = {
  id: string
  name: string
  niche: string
  config: TrendTaskConfig
  schedule_minutes: number
  is_active: boolean
  last_run_at: string | null
  created_at?: string
  updated_at?: string
}

export type TrendAnalyzedFeedItem = {
  id: string
  task_id: string
  relevance: number
  sentiment: string
  virality_score: number
  impact_summary: string
  keywords: string[]
  signal_type: string[]
  product_angle: string | null
  content_angle: string | null
  is_emerging: boolean
  analyzed_at: string
  raw?: {
    id: string
    source: string
    url: string | null
    title: string
    author: string | null
    media: Array<{ url: string; type?: string }>
  } | null
  task?: { id: string; name: string } | null
}

export type TrendAlert = {
  id: string
  task_id: string
  severity: string
  title: string
  body: string
  is_read: boolean
  created_at: string
}

export const TREND_SOURCE_LABELS: Record<string, string> = {
  reddit: 'Reddit',
  youtube: 'YouTube',
  rss: 'Noticias / RSS',
  gtrends_rss: 'Google Trends',
  hn: 'Hacker News',
  bluesky: 'Bluesky',
  arxiv: 'arXiv',
  lobsters: 'Lobsters',
}

function emptyConfig(): TrendTaskConfig {
  return {
    context: '',
    goal: 'both',
    keywords: [],
    must_include: [],
    exclude: [],
    news_queries: [],
    subreddits: [],
    youtube_channel_ids: [],
    rss_feeds: [],
    trends_geos: ['AR', 'US'],
    bluesky_queries: [],
    sources_enabled: ['reddit', 'youtube', 'rss', 'gtrends_rss', 'hn', 'bluesky'],
  }
}

function parseConfig(raw: unknown): TrendTaskConfig {
  const base = emptyConfig()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const arr = (v: unknown) =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []
  const goalRaw = String(o.goal ?? 'both').toLowerCase()
  const goal: TrendSearchGoal =
    goalRaw === 'product' || goalRaw === 'content' || goalRaw === 'both' ? goalRaw : 'both'
  return {
    context: typeof o.context === 'string' ? o.context.trim() : '',
    goal,
    keywords: arr(o.keywords),
    must_include: arr(o.must_include),
    exclude: arr(o.exclude),
    news_queries: arr(o.news_queries),
    subreddits: arr(o.subreddits),
    youtube_channel_ids: arr(o.youtube_channel_ids),
    rss_feeds: arr(o.rss_feeds),
    trends_geos: arr(o.trends_geos),
    bluesky_queries: arr(o.bluesky_queries),
    sources_enabled: arr(o.sources_enabled),
  }
}

function mapTask(row: Record<string, unknown>): TrendSearchTask {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    niche: String(row.niche ?? ''),
    config: parseConfig(row.config),
    schedule_minutes: Number(row.schedule_minutes) || 30,
    is_active: Boolean(row.is_active),
    last_run_at: typeof row.last_run_at === 'string' ? row.last_run_at : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : undefined,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : undefined,
  }
}

async function accessToken(): Promise<string> {
  if (!supabase) throw new Error('Supabase no está configurado')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error(formatSupabaseOrError(error))
  const token = data.session?.access_token
  if (!token) throw new Error('Tenés que iniciar sesión')
  return token
}

export async function listTrendTasks(): Promise<TrendSearchTask[]> {
  if (!supabase) throw new Error('Supabase no está configurado')
  const { data, error } = await supabase
    .from('trend_search_tasks')
    .select('id, name, niche, config, schedule_minutes, is_active, last_run_at, created_at, updated_at')
    .order('created_at', { ascending: true })
  if (error) throw new Error(formatSupabaseOrError(error))
  return (data ?? []).map((r) => mapTask(r as Record<string, unknown>))
}

export async function upsertTrendTask(input: {
  id?: string
  name: string
  niche: string
  schedule_minutes: number
  is_active: boolean
  config: TrendTaskConfig
}): Promise<TrendSearchTask> {
  if (!supabase) throw new Error('Supabase no está configurado')
  const payload = {
    name: input.name.trim(),
    niche: input.niche.trim(),
    schedule_minutes: input.schedule_minutes,
    is_active: input.is_active,
    config: input.config,
    updated_at: new Date().toISOString(),
  }

  if (input.id) {
    const { data, error } = await supabase
      .from('trend_search_tasks')
      .update(payload)
      .eq('id', input.id)
      .select('id, name, niche, config, schedule_minutes, is_active, last_run_at, created_at, updated_at')
      .single()
    if (error) throw new Error(formatSupabaseOrError(error))
    return mapTask(data as Record<string, unknown>)
  }

  const { data, error } = await supabase
    .from('trend_search_tasks')
    .insert(payload)
    .select('id, name, niche, config, schedule_minutes, is_active, last_run_at, created_at, updated_at')
    .single()
  if (error) throw new Error(formatSupabaseOrError(error))
  return mapTask(data as Record<string, unknown>)
}

export async function deleteTrendTask(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado')
  const { error } = await supabase.from('trend_search_tasks').delete().eq('id', id)
  if (error) throw new Error(formatSupabaseOrError(error))
}

export async function listTrendFeed(opts?: {
  taskId?: string
  limit?: number
}): Promise<TrendAnalyzedFeedItem[]> {
  if (!supabase) throw new Error('Supabase no está configurado')
  let q = supabase
    .from('trend_analyzed_items')
    .select(
      `
      id, task_id, relevance, sentiment, virality_score, impact_summary, keywords, signal_type,
      product_angle, content_angle, is_emerging, analyzed_at,
      raw:trend_raw_items ( id, source, url, title, author, media ),
      task:trend_search_tasks ( id, name )
    `,
    )
    .order('analyzed_at', { ascending: false })
    .limit(opts?.limit ?? 60)

  if (opts?.taskId) q = q.eq('task_id', opts.taskId)

  const { data, error } = await q
  if (error) throw new Error(formatSupabaseOrError(error))

  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>
    const raw = r.raw as TrendAnalyzedFeedItem['raw']
    const task = r.task as TrendAnalyzedFeedItem['task']
    return {
      id: String(r.id),
      task_id: String(r.task_id),
      relevance: Number(r.relevance) || 0,
      sentiment: String(r.sentiment ?? 'neutral'),
      virality_score: Number(r.virality_score) || 0,
      impact_summary: String(r.impact_summary ?? ''),
      keywords: Array.isArray(r.keywords) ? r.keywords.map(String) : [],
      signal_type: Array.isArray(r.signal_type) ? r.signal_type.map(String) : [],
      product_angle: r.product_angle == null ? null : String(r.product_angle),
      content_angle: r.content_angle == null ? null : String(r.content_angle),
      is_emerging: Boolean(r.is_emerging),
      analyzed_at: String(r.analyzed_at ?? ''),
      raw: raw ?? null,
      task: task ?? null,
    }
  })
}

export async function listTrendAlerts(limit = 40): Promise<TrendAlert[]> {
  if (!supabase) throw new Error('Supabase no está configurado')
  const { data, error } = await supabase
    .from('trend_alerts')
    .select('id, task_id, severity, title, body, is_read, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(formatSupabaseOrError(error))
  return (data ?? []).map((r) => ({
    id: String(r.id),
    task_id: String(r.task_id),
    severity: String(r.severity ?? 'info'),
    title: String(r.title ?? ''),
    body: String(r.body ?? ''),
    is_read: Boolean(r.is_read),
    created_at: String(r.created_at ?? ''),
  }))
}

export async function markTrendAlertRead(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado')
  const { error } = await supabase.from('trend_alerts').update({ is_read: true }).eq('id', id)
  if (error) throw new Error(formatSupabaseOrError(error))
}

export async function runTrendsNow(taskId?: string): Promise<Record<string, unknown>> {
  const token = await accessToken()
  const qs = taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''
  const resp = await fetch(`/api/trends/run${qs}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })
  const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>
  if (!resp.ok || json.ok === false) {
    throw new Error(formatHttpApiError(json.error ?? json.detail ?? json.message, resp.status))
  }
  return json
}

export { emptyConfig as emptyTrendTaskConfig }
