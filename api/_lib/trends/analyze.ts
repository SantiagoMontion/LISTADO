import { firstEnv } from '../importados-sync/env.js'
import {
  clampScore,
  type AnalysisResult,
  type NormalizedTrendItem,
  type TrendSearchTask,
} from './types.js'

function engagementScore(item: NormalizedTrendItem): number {
  const e = item.engagement
  const score =
    (e.score || 0) +
    (e.points || 0) +
    (e.likes || 0) * 1.2 +
    (e.reposts || 0) * 2 +
    (e.comments || 0) * 1.5 +
    (e.approx_traffic || 0) / 50
  return score
}

function detectLanguage(text: string): string {
  if (/[áéíóúñ¿¡]/i.test(text)) return 'es'
  if (/[a-z]/i.test(text)) return 'en'
  return 'other'
}

function keywordHits(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase()
  return keywords.filter((k) => lower.includes(k.toLowerCase()))
}

function goalHint(goal: string): string {
  if (goal === 'product') return 'Priorizá oportunidades de producto/merch/importados.'
  if (goal === 'content') return 'Priorizá ideas de contenido (posts, reels, videos, hooks).'
  return 'Buscá tanto producto/merch como ideas de contenido.'
}

export function analyzeHeuristic(
  item: NormalizedTrendItem,
  task: TrendSearchTask,
): AnalysisResult {
  const text = `${item.title}\n${item.body}`
  const searchTerms = [
    ...task.config.keywords,
    ...task.config.must_include,
    ...task.config.news_queries,
  ]
  const hits = keywordHits(text, searchTerms)
  const eng = engagementScore(item)
  const relevance = clampScore(
    hits.length * 25 + (eng > 0 ? 20 : 0) + (item.source === 'gtrends_rss' ? 25 : 0),
  )
  const virality = clampScore(
    Math.log10(eng + 1) * 35 + (item.source === 'gtrends_rss' ? 40 : 0) + hits.length * 8,
  )

  const lower = text.toLowerCase()
  let sentiment: AnalysisResult['sentiment'] = 'neutral'
  if (/(amazing|love|best|fire|hype|increíble|genial|brutal)/i.test(lower)) sentiment = 'positive'
  if (/(hate|scam|bad|terrible|worst|estafa|malo)/i.test(lower)) {
    sentiment = sentiment === 'positive' ? 'mixed' : 'negative'
  }

  const signal_type: string[] = []
  const wantProduct = task.config.goal !== 'content'
  const wantContent = task.config.goal !== 'product'

  if (wantProduct && /(merch|figure|figurine|hoodie|shirt|drop|product|buy|shop|store|sku)/i.test(lower)) {
    signal_type.push('product_opportunity')
  }
  if (wantContent && /(tutorial|guide|tips|meme|trailer|reaction|review|video|reel|post)/i.test(lower)) {
    signal_type.push('content_idea')
  }
  if (item.source === 'rss' || item.source === 'gtrends_rss' || item.source === 'hn') {
    signal_type.push('news_impact')
  }
  if (!signal_type.length) {
    signal_type.push(wantProduct && !wantContent ? 'product_opportunity' : 'content_idea')
  }

  const is_emerging = virality >= 65 && relevance >= 40
  const product_angle =
    wantProduct && signal_type.includes('product_opportunity')
      ? `Explorar merch/producto alrededor de: ${item.title.slice(0, 80)}`
      : wantProduct
        ? `¿Hay ángulo de producto en «${item.title.slice(0, 60)}»?`
        : null
  const content_angle = wantContent
    ? `Idea de contenido: ángulo sobre «${item.title.slice(0, 70)}» (${item.source})`
    : null

  const ctxBit = task.config.context ? ` Contexto: ${task.config.context.slice(0, 80)}.` : ''

  return {
    relevance,
    sentiment,
    virality_score: virality,
    impact_summary: hits.length
      ? `Señal ${item.source} alineada a ${hits.slice(0, 3).join(', ')} (eng ~${Math.round(eng)}).${ctxBit}`
      : `Señal ${item.source}: ${item.title.slice(0, 100)}.${ctxBit}`,
    keywords: hits.length ? hits : task.config.keywords.slice(0, 3),
    entities: [],
    signal_type,
    product_angle,
    content_angle,
    is_emerging,
    confidence: 0.45,
    language: detectLanguage(text),
  }
}

function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no json in llm response')
  return JSON.parse(text.slice(start, end + 1))
}

export async function analyzeWithGemini(
  item: NormalizedTrendItem,
  task: TrendSearchTask,
): Promise<AnalysisResult | null> {
  const apiKey = firstEnv(['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'])
  if (!apiKey) return null

  const model = firstEnv(['GEMINI_MODEL']) || 'gemini-2.0-flash'
  const prompt = `Sos un analista de tendencias para NotMid (merch / importados / contenido).
Búsqueda: "${task.name}"
${goalHint(task.config.goal)}
Contexto del usuario: ${task.config.context || '(sin contexto extra)'}
Keywords: ${task.config.keywords.join(', ') || '(ninguna)'}
Debe incluir (si aplica): ${task.config.must_include.join(', ') || '—'}
Excluir: ${task.config.exclude.join(', ') || '—'}

ITEM:
source=${item.source}
title=${item.title}
author=${item.author ?? ''}
url=${item.url ?? ''}
engagement=${JSON.stringify(item.engagement)}
body=${item.body.slice(0, 1200)}

Respondé SOLO un JSON válido con exactamente estas claves:
{
  "relevance": 0-100,
  "sentiment": "positive|neutral|negative|mixed",
  "virality_score": 0-100,
  "impact_summary": "1-2 oraciones en español",
  "keywords": ["..."],
  "entities": ["..."],
  "signal_type": ["product_opportunity","content_idea","news_impact","meme_culture","risk_controversy"],
  "product_angle": "string o null",
  "content_angle": "string o null",
  "is_emerging": true/false,
  "confidence": 0-1,
  "language": "es|en|other"
}`

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 700 },
    }),
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`Gemini ${resp.status}: ${detail.slice(0, 200)}`)
  }
  const json = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
  const parsed = extractJsonObject(text) as Record<string, unknown>

  const sentimentRaw = String(parsed.sentiment || 'neutral')
  const sentiment =
    sentimentRaw === 'positive' ||
    sentimentRaw === 'negative' ||
    sentimentRaw === 'mixed' ||
    sentimentRaw === 'neutral'
      ? sentimentRaw
      : 'neutral'

  return {
    relevance: clampScore(Number(parsed.relevance) || 0),
    sentiment,
    virality_score: clampScore(Number(parsed.virality_score) || 0),
    impact_summary: String(parsed.impact_summary || '').slice(0, 500),
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).slice(0, 12) : [],
    entities: Array.isArray(parsed.entities) ? parsed.entities.map(String).slice(0, 12) : [],
    signal_type: Array.isArray(parsed.signal_type)
      ? parsed.signal_type.map(String).slice(0, 8)
      : [],
    product_angle: parsed.product_angle == null ? null : String(parsed.product_angle),
    content_angle: parsed.content_angle == null ? null : String(parsed.content_angle),
    is_emerging: Boolean(parsed.is_emerging),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.6)),
    language: String(parsed.language || detectLanguage(`${item.title} ${item.body}`)),
  }
}

export async function analyzeItem(
  item: NormalizedTrendItem,
  task: TrendSearchTask,
): Promise<AnalysisResult> {
  try {
    const llm = await analyzeWithGemini(item, task)
    if (llm) return llm
  } catch {
    // fallback heurístico
  }
  return analyzeHeuristic(item, task)
}
