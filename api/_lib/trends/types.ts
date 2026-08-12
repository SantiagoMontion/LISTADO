import { createHash } from 'node:crypto'

export type TrendSourceId =
  | 'reddit'
  | 'youtube'
  | 'rss'
  | 'gtrends_rss'
  | 'hn'
  | 'bluesky'
  | 'wikipedia'
  | 'lobsters'
  | 'mastodon'
  | 'arxiv'

export type TrendTaskConfig = {
  keywords: string[]
  subreddits: string[]
  youtube_channel_ids: string[]
  rss_feeds: string[]
  trends_geos: string[]
  bluesky_queries: string[]
  sources_enabled: TrendSourceId[]
}

export type TrendSearchTask = {
  id: string
  name: string
  niche: string
  config: TrendTaskConfig
  schedule_minutes: number
  is_active: boolean
  last_run_at: string | null
}

export type NormalizedTrendItem = {
  source: TrendSourceId
  externalId: string
  url: string | null
  title: string
  body: string
  author: string | null
  publishedAt: string | null
  media: Array<{ url: string; type?: string }>
  engagement: Record<string, number>
  raw: Record<string, unknown>
}

export type AnalysisResult = {
  relevance: number
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
  virality_score: number
  impact_summary: string
  keywords: string[]
  entities: string[]
  signal_type: string[]
  product_angle: string | null
  content_angle: string | null
  is_emerging: boolean
  confidence: number
  language: string
}

export function emptyTaskConfig(): TrendTaskConfig {
  return {
    keywords: [],
    subreddits: [],
    youtube_channel_ids: [],
    rss_feeds: [],
    trends_geos: ['AR', 'US'],
    bluesky_queries: [],
    sources_enabled: ['reddit', 'youtube', 'rss', 'gtrends_rss', 'hn', 'bluesky'],
  }
}

export function parseTaskConfig(raw: unknown): TrendTaskConfig {
  const base = emptyTaskConfig()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []
  return {
    keywords: strArr(o.keywords),
    subreddits: strArr(o.subreddits),
    youtube_channel_ids: strArr(o.youtube_channel_ids),
    rss_feeds: strArr(o.rss_feeds),
    trends_geos: strArr(o.trends_geos).map((g) => g.toUpperCase()),
    bluesky_queries: strArr(o.bluesky_queries),
    sources_enabled: strArr(o.sources_enabled) as TrendSourceId[],
  }
}

export function normalizeUrl(url: string | null | undefined): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    u.hash = ''
    ;['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'fbclid'].forEach(
      (k) => u.searchParams.delete(k),
    )
    return u.toString()
  } catch {
    return url.trim()
  }
}

export function contentHash(title: string, url: string | null, body = ''): string {
  const key = `${title.trim().toLowerCase()}|${normalizeUrl(url)}|${body.slice(0, 280).trim().toLowerCase()}`
  return createHash('sha256').update(key).digest('hex')
}

export function clusterFingerprint(title: string, keywords: string[]): string {
  const words = `${title} ${keywords.join(' ')}`
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñü\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 8)
    .sort()
  return createHash('sha256').update(words.join('|')).digest('hex').slice(0, 24)
}

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}
