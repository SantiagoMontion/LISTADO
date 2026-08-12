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

export type TrendSearchGoal = 'both' | 'product' | 'content'

export type TrendTaskConfig = {
  /** Qué estás buscando y por qué (para el análisis). */
  context: string
  /** product | content | both */
  goal: TrendSearchGoal
  keywords: string[]
  /** Al menos uno debe aparecer en título/body (si hay alguno). */
  must_include: string[]
  /** Si aparece, se descarta. */
  exclude: string[]
  /** Consultas para Google News RSS (se arman solos). */
  news_queries: string[]
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

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []
}

export function parseTaskConfig(raw: unknown): TrendTaskConfig {
  const base = emptyTaskConfig()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const goalRaw = String(o.goal ?? 'both').toLowerCase()
  const goal: TrendSearchGoal =
    goalRaw === 'product' || goalRaw === 'content' || goalRaw === 'both' ? goalRaw : 'both'
  return {
    context: typeof o.context === 'string' ? o.context.trim() : '',
    goal,
    keywords: strArr(o.keywords),
    must_include: strArr(o.must_include),
    exclude: strArr(o.exclude),
    news_queries: strArr(o.news_queries),
    subreddits: strArr(o.subreddits),
    youtube_channel_ids: strArr(o.youtube_channel_ids),
    rss_feeds: strArr(o.rss_feeds),
    trends_geos: strArr(o.trends_geos).map((g) => g.toUpperCase()),
    bluesky_queries: strArr(o.bluesky_queries),
    sources_enabled: strArr(o.sources_enabled) as TrendSourceId[],
  }
}

/** Arma feeds de Google News a partir de queries libres. */
export function buildGoogleNewsFeeds(queries: string[], geos: string[]): string[] {
  const geosUse = geos.length ? geos : ['AR']
  const out: string[] = []
  for (const q of queries.slice(0, 6)) {
    for (const geo of geosUse.slice(0, 2)) {
      const hl = geo === 'US' || geo === 'GB' ? 'en' : 'es-419'
      const ceid = geo === 'US' || geo === 'GB' ? `${geo}:en` : `${geo}:es-419`
      out.push(
        `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${geo}&ceid=${ceid}`,
      )
    }
  }
  return out
}

export function itemPassesTaskFilters(
  item: Pick<NormalizedTrendItem, 'title' | 'body' | 'publishedAt' | 'source'>,
  config: TrendTaskConfig,
  opts?: { maxAgeDays?: number },
): boolean {
  const text = `${item.title}\n${item.body}`
  const lower = text.toLowerCase()

  for (const bad of config.exclude) {
    if (bad && lower.includes(bad.toLowerCase())) return false
  }

  if (!isAllowedLanguage(text)) return false
  if (!isRecentEnough(item.publishedAt, opts?.maxAgeDays ?? maxAgeDaysForSource(item.source))) {
    return false
  }

  if (config.must_include.length) {
    return config.must_include.some((need) => lower.includes(need.toLowerCase()))
  }

  // Si hay keywords, exigir al menos un match (salvo que la fuente ya buscó por query).
  // gtrends_rss y lobsters/trending globales sí requieren match.
  const terms = [
    ...config.keywords,
    ...config.news_queries,
    ...config.bluesky_queries,
  ].filter(Boolean)
  if (
    terms.length &&
    (item.source === 'gtrends_rss' || item.source === 'lobsters' || item.source === 'mastodon')
  ) {
    return terms.some((t) => lower.includes(t.toLowerCase()))
  }

  return true
}

/** Solo español / inglés (bloquea CJK, cirílico, árabe, etc.). */
export function isAllowedLanguage(text: string): boolean {
  const sample = text.slice(0, 800)
  if (!sample.trim()) return true

  if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0e00-\u0e7f]/u.test(sample)) {
    return false
  }

  const letters = sample.replace(/[^a-záéíóúüñàèìòùäëïöüç]/gi, '')
  if (letters.length < 8) return true

  // Si tiene signos/palabras típicas ES/EN, ok
  if (/[áéíóúñ¿¡]/i.test(sample)) return true
  if (
    /\b(the|and|for|with|this|that|new|best|game|anime|merch|how|what|why|el|la|los|las|de|del|que|una|para|con|tendencia|nuevo|nueva)\b/i.test(
      sample,
    )
  ) {
    return true
  }

  // Texto latino genérico: aceptar (muchas keywords EN)
  if (/^[a-záéíóúüñ\s\d'".,:;!?()/-]+$/i.test(sample.replace(/\s+/g, ' ').trim())) return true

  // Si hay muchas letras latinas vs total, ok
  const latin = (sample.match(/[a-záéíóúüñ]/gi) || []).length
  const other = (sample.match(/[^\x00-\x7FáéíóúüñÁÉÍÓÚÜÑ¿¡]/g) || []).length
  return latin >= other * 2
}

export function maxAgeDaysForSource(source: string): number {
  // Social más fresco; noticias un poco más margen. Nada de años viejos.
  if (source === 'reddit' || source === 'bluesky' || source === 'hn') return 10
  if (source === 'youtube' || source === 'gtrends_rss') return 14
  return 21
}

export function isRecentEnough(publishedAt: string | null | undefined, maxAgeDays: number): boolean {
  if (!publishedAt) return true // sin fecha: no descartamos acá (otra capa puede filtrar)
  const t = Date.parse(publishedAt)
  if (!Number.isFinite(t)) return true
  const ageMs = Date.now() - t
  if (ageMs < 0) return true // futuro raro / timezone
  return ageMs <= maxAgeDays * 24 * 60 * 60 * 1000
}

export function detectContentLanguage(text: string): 'es' | 'en' | 'other' {
  if (!isAllowedLanguage(text)) return 'other'
  if (/[áéíóúñ¿¡]/i.test(text)) return 'es'
  if (
    /\b(el|la|los|las|una|para|cómo|qué|tendencia|nuevo|nueva|merch)\b/i.test(text)
  ) {
    return 'es'
  }
  return 'en'
}

export function buildAlertCopy(opts: {
  taskName: string
  title: string
  source: string
  analysis: AnalysisResult
  url?: string | null
}): { title: string; body: string; severity: string } {
  const a = opts.analysis
  const why =
    a.relevance >= 70
      ? 'Alta relevancia a tu búsqueda'
      : a.is_emerging
        ? 'Señal emergente'
        : a.virality_score >= 70
          ? 'Alto potencial de viralidad'
          : 'Match con tu vigilancia'

  const lines = [
    why + '.',
    a.impact_summary,
    a.product_angle ? `Producto: ${a.product_angle}` : null,
    a.content_angle ? `Contenido: ${a.content_angle}` : null,
    `Scores — relevancia ${a.relevance}/100, viralidad ${a.virality_score}/100, sentimiento ${a.sentiment}.`,
    opts.url ? `Link: ${opts.url}` : null,
  ].filter(Boolean)

  return {
    title: `${opts.taskName} · ${opts.source}: ${opts.title.slice(0, 90)}`,
    body: lines.join('\n'),
    severity: a.virality_score >= 80 && a.relevance >= 60 ? 'high' : a.is_emerging ? 'medium' : 'info',
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
