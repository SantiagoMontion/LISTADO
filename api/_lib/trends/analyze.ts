import { firstEnv } from '../importados-sync/env.js'
import {
  clampScore,
  detectContentLanguage,
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
  return detectContentLanguage(text)
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
    hits.length * 28 + (eng > 0 ? 15 : 0) + (task.config.context ? 5 : 0),
  )
  const virality = clampScore(Math.log10(eng + 1) * 35 + hits.length * 10)

  const lower = text.toLowerCase()
  let sentiment: AnalysisResult['sentiment'] = 'neutral'
  if (/(amazing|love|best|fire|hype|increíble|genial|brutal|trending)/i.test(lower)) {
    sentiment = 'positive'
  }
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

  const is_emerging = virality >= 65 && relevance >= 50 && hits.length > 0
  const product_angle =
    wantProduct && (signal_type.includes('product_opportunity') || relevance >= 55)
      ? `Oportunidad posible: «${item.title.slice(0, 80)}» — evaluar stock/precio/merch.`
      : null
  const content_angle = wantContent
    ? `Hook de contenido: «${item.title.slice(0, 70)}» (${item.source}). Ángulo: por qué está pidiendo atención ahora.`
    : null

  const matched = hits.slice(0, 4).join(', ')
  const impact_summary = matched
    ? `Encaja con tu búsqueda por: ${matched}. Fuente ${item.source}, engagement ~${Math.round(eng)}. ${task.config.context ? `Contexto: ${task.config.context.slice(0, 100)}` : ''}`.trim()
    : `Baja coincidencia con tus keywords (${item.source}). Revisar solo si el título aporta.`

  return {
    relevance,
    sentiment,
    virality_score: virality,
    impact_summary: impact_summary.slice(0, 500),
    keywords: hits.length ? hits : task.config.keywords.slice(0, 3),
    entities: [],
    signal_type,
    product_angle,
    content_angle,
    is_emerging,
    confidence: hits.length ? 0.55 : 0.3,
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
Respondé siempre en español.
Solo considerá contenido en español o inglés; si el item está en otro idioma, poné relevance=0 y language="other".
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
  "impact_summary": "2 oraciones en español: qué pasó y por qué importa para esta búsqueda",
  "keywords": ["..."],
  "entities": ["..."],
  "signal_type": ["product_opportunity","content_idea","news_impact","meme_culture","risk_controversy"],
  "product_angle": "acción concreta de producto/merch o null",
  "content_angle": "hook concreto de contenido o null",
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
